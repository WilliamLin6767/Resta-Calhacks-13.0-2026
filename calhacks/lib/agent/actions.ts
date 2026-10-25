// The action log and approval gate (supabase/18_agent_actions.sql).
//
//   propose   the agent, the loop or an owner button records a Commit action as 'proposed'
//   approve   only the owner's approve route: proposed -> approved (not once it has expired)
//   reject    proposed -> rejected; the record it points at is left untouched
//   execute   claims approved -> running with a conditional update (so it runs exactly once),
//             runs the tool's executor, which re-checks its limits in code, then writes done or failed
//   actNow    an owner button: propose, approve and execute in one request
//
// Plain functions over an ActionStore, so the rules can be tested without a database.
import type { SupabaseClient } from "@supabase/supabase-js";
import { RESTAURANT_ID } from "@/lib/supabase";

export const ACTION_STATUSES = ["proposed", "approved", "running", "done", "failed", "rejected", "undone", "expired"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ActionSource = "agent" | "loop" | "owner";

export type Impact = { amount_usd: number | null; per: "week" | "once"; basis: string; assumptions?: string[] };
export type Evidence = { label: string; value: string; href?: string }[];

export type ActionRow = {
  id: number;
  restaurant_id: number;
  case_id: number | null;
  tool: string;
  tier: string;
  title: string;
  summary: string;
  args: Record<string, unknown>;
  evidence: Evidence;
  impact: Impact | null;
  status: ActionStatus;
  source: ActionSource;
  surface: string | null;
  approved_at: string | null;
  approved_by: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  done_at: string | null;
  expires_at: string;
};

export type NewAction = {
  tool: string;
  title: string;
  summary: string;
  args: Record<string, unknown>;
  evidence?: Evidence;
  impact?: Impact | null;
  source: ActionSource;
  surface?: string | null;
  case_id?: number | null;
};

export class ActionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// The table isn't there yet (18_agent_actions.sql not run)
export class ActionTableMissing extends Error {}

export type ActionStore = {
  insert(row: NewAction): Promise<ActionRow>;
  get(id: number): Promise<ActionRow | null>;
  // Applies `patch` only while the row is in one of `from` (and, with notExpiredAt, not expired).
  // Returns the updated row, or null when it wasn't in those statuses: someone else got there first.
  update(id: number, from: ActionStatus[], patch: Partial<ActionRow>, notExpiredAt?: string): Promise<ActionRow | null>;
  list(filter: { status?: ActionStatus; case_id?: number; limit?: number }): Promise<ActionRow[]>;
};

// What runs an approved action: re-checks its limits, calls the service, returns what it made or
// changed (stored as result). Throws to fail.
export type Executor = (row: ActionRow) => Promise<Record<string, unknown>>;

// ---------- The rules ----------

export async function propose(store: ActionStore, input: NewAction, executors: Record<string, Executor>): Promise<ActionRow> {
  if (!executors[input.tool]) throw new ActionError(`${input.tool} isn't an action that can be approved.`, 400);
  return store.insert(input);
}

export async function approve(store: ActionStore, id: number, owner: string, now = new Date()): Promise<ActionRow> {
  const row = await store.get(id);
  if (!row) throw new ActionError("That action isn't here.", 404);
  if (row.status === "proposed" && Date.parse(row.expires_at) <= now.getTime()) {
    await store.update(id, ["proposed"], { status: "expired" });
    throw new ActionError("This proposal has expired. Ask again for a fresh one.", 410);
  }
  if (row.status !== "proposed") throw new ActionError(`This action is already ${row.status}.`, 409);
  const approved = await store.update(id, ["proposed"], { status: "approved", approved_at: now.toISOString(), approved_by: owner }, now.toISOString());
  if (!approved) throw new ActionError("This action was decided in the meantime.", 409);
  return approved;
}

export async function reject(store: ActionStore, id: number, owner: string, now = new Date()): Promise<ActionRow> {
  const rejected = await store.update(id, ["proposed"], { status: "rejected", approved_by: owner, done_at: now.toISOString() });
  if (rejected) return rejected;
  const row = await store.get(id);
  if (!row) throw new ActionError("That action isn't here.", 404);
  throw new ActionError(`This action is already ${row.status}.`, 409);
}

// Runs an approved action exactly once. A second call (a double tap, an overlapping request)
// finds it already claimed and just returns it.
export async function execute(store: ActionStore, id: number, executors: Record<string, Executor>, now = () => new Date()): Promise<ActionRow & { thrown?: unknown }> {
  const claimed = await store.update(id, ["approved"], { status: "running" });
  if (!claimed) {
    const row = await store.get(id);
    if (!row) throw new ActionError("That action isn't here.", 404);
    return row;
  }
  const run = executors[claimed.tool];
  try {
    if (!run) throw new ActionError(`${claimed.tool} has no executor.`, 400);
    const result = await run(claimed);
    return (await store.update(id, ["running"], { status: "done", result, error: null, done_at: now().toISOString() })) ?? claimed;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const failed = (await store.update(id, ["running"], { status: "failed", error, done_at: now().toISOString() })) ?? claimed;
    return { ...failed, thrown: err };
  }
}

// An owner button: the same functions in one request, so the log is complete either way. If the
// executor fails, its original error is thrown so the route answers exactly as it did before.
// Without the table (SQL not run yet) the executor still runs, and the result says so.
export async function actNow(store: ActionStore, input: Omit<NewAction, "source">, owner: string, executors: Record<string, Executor>): Promise<{ action: ActionRow | null; result: Record<string, unknown> }> {
  let proposed: ActionRow;
  try {
    proposed = await propose(store, { ...input, source: "owner" }, executors);
  } catch (err) {
    if (!(err instanceof ActionTableMissing)) throw err;
    const fake = { id: 0, tool: input.tool, args: input.args, source: "owner", status: "running" } as unknown as ActionRow;
    return { action: null, result: await executors[input.tool](fake) };
  }
  await approve(store, proposed.id, owner);
  const done = await execute(store, proposed.id, executors);
  if (done.status === "failed") throw done.thrown ?? new Error(done.error ?? "The action failed.");
  const { thrown: _thrown, ...action } = done;
  void _thrown;
  return { action, result: action.result ?? {} };
}

// ---------- On Supabase ----------

const missing = (message: string) => /agent_actions|schema cache|does not exist/i.test(message);

export function supabaseActions(db: SupabaseClient): ActionStore {
  const table = () => db.from("agent_actions");
  const fail = (what: string, message: string): never => {
    if (missing(message)) throw new ActionTableMissing(`The action log isn't set up: run supabase/18_agent_actions.sql. (${message})`);
    throw new Error(`Could not ${what}: ${message}`);
  };
  return {
    async insert(row) {
      const res = await table()
        .insert({ restaurant_id: RESTAURANT_ID, tier: "commit", evidence: [], impact: null, surface: null, case_id: null, ...row })
        .select("*")
        .single();
      if (res.error) fail("save the action", res.error.message);
      return res.data as ActionRow;
    },
    async get(id) {
      const res = await table().select("*").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle();
      if (res.error) fail("load the action", res.error.message);
      return (res.data as ActionRow | null) ?? null;
    },
    async update(id, from, patch, notExpiredAt) {
      let q = table().update(patch).eq("id", id).eq("restaurant_id", RESTAURANT_ID).in("status", from);
      if (notExpiredAt) q = q.gt("expires_at", notExpiredAt);
      const res = await q.select("*").maybeSingle();
      if (res.error) fail("update the action", res.error.message);
      return (res.data as ActionRow | null) ?? null;
    },
    async list({ status, case_id, limit }) {
      let q = table().select("*").eq("restaurant_id", RESTAURANT_ID).order("created_at", { ascending: false }).limit(limit ?? 100);
      if (status) q = q.eq("status", status);
      if (case_id) q = q.eq("case_id", case_id);
      const res = await q;
      if (res.error) fail("load the actions", res.error.message);
      return (res.data ?? []) as ActionRow[];
    },
  };
}

// Proposals still waiting for the owner, for the agent's prompt. Empty when the table isn't there yet.
export async function openProposals(db: SupabaseClient, limit = 5): Promise<{ id: number; title: string }[]> {
  const res = await db.from("agent_actions").select("id, title, expires_at").eq("restaurant_id", RESTAURANT_ID).eq("status", "proposed").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(limit);
  return res.error ? [] : ((res.data ?? []) as { id: number; title: string }[]);
}
