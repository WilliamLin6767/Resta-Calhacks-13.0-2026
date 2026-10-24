// Tells Convex that something changed, after it's been written to Supabase (server only).
// Best effort: a failure or a slow Convex logs one "[live] ..." line and is otherwise ignored,
// and with Convex off (lib/live/client.ts) nothing here does anything.
//
//   toLiveCall   the parts of a call_requests row the calls panel shows while it changes
//   syncCalls    copy those calls and the pending counts to Convex, and bump their topics
//   bump         wake the open screens that show these topics
//   resyncAll    start over from Supabase (POST /api/live/resync)
//
// Write routes use signalAfter / syncCallsAfter: one line after the Supabase write, run once the
// response is sent, so a route is never slower or broken because of Convex.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Topic } from "@/convex/topics";
import { pendingCounts, type PendingCounts } from "@/lib/calls/service";
import { OPEN_STATUSES, type CallRow } from "@/lib/calls/types";
import { RESTAURANT_ID } from "@/lib/supabase";
import { LIVE_TIMEOUT_MS, liveClient, liveEnabled, liveSecret } from "./client";
import { callSection, ROUTE_TOPICS, type LiveRoute } from "./routeTopics";

type Db = SupabaseClient;

// What signalling needs from ConvexHttpClient (a fake one in tests).
export type LiveClient = { mutation: (ref: never, args: never, options?: { skipQueue: boolean }) => Promise<unknown> };
export type LiveDeps = { client: () => LiveClient | null; secret: () => string; timeoutMs: number; log: (line: string) => void };

const defaultDeps: LiveDeps = {
  client: () => liveClient() as unknown as LiveClient | null,
  secret: liveSecret,
  timeoutMs: LIVE_TIMEOUT_MS,
  log: (line) => console.warn(line),
};

export type LiveCall = {
  callId: number;
  restaurantId: number;
  contextType: string;
  contextId: number;
  supplierId: number;
  status: CallRow["status"];
  progress?: string;
  question?: string;
  outcome?: string;
  stage?: "summarizing";
  updatedAt: number;
};

// The columns toLiveCall reads. Never the transcript, the brief or the dialed number.
const LIVE_COLUMNS = "id, restaurant_id, context_type, context_id, supplier_id, status, progress, question, outcome, result";
export type LiveSource = Pick<CallRow, "id" | "restaurant_id" | "context_type" | "context_id" | "supplier_id" | "status" | "progress" | "question" | "outcome" | "result">;

// Only what's listed here goes to Convex: no transcript, brief, phone numbers, Q&A or money.
export function toLiveCall(row: LiveSource, now = Date.now()): LiveCall {
  const call: LiveCall = {
    callId: row.id,
    restaurantId: row.restaurant_id,
    contextType: row.context_type,
    contextId: row.context_id,
    supplierId: row.supplier_id,
    status: row.status,
    updatedAt: now,
  };
  // Left out instead of sent as null, since Convex has no undefined
  if (row.progress) call.progress = row.progress;
  if (row.question) call.question = row.question;
  if (row.outcome) call.outcome = row.outcome;
  if (row.result?.stage === "summarizing") call.stage = "summarizing";
  return call;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// One mutation, cut off after the timeout. Skips the client's queue, so one slow call doesn't
// hold up the next.
function send(deps: LiveDeps, client: LiveClient, ref: unknown, args: Record<string, unknown>) {
  const call = client.mutation(ref as never, { ...args, secret: deps.secret() } as never, { skipQueue: true });
  return withTimeout(call, deps.timeoutMs);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// The client, or null when Convex is off (or its URL is unusable).
function clientOf(deps: LiveDeps): LiveClient | null {
  try {
    return deps.client();
  } catch (err) {
    deps.log(`[live] no client: ${message(err)}`);
    return null;
  }
}

export async function bump(topics: Topic[], deps: LiveDeps = defaultDeps): Promise<void> {
  const client = clientOf(deps);
  if (!client || topics.length === 0) return;
  try {
    await send(deps, client, api.live.bump, { restaurantId: RESTAURANT_ID, topics: [...new Set(topics)] });
  } catch (err) {
    deps.log(`[live] bump ${topics.join(",")} failed: ${message(err)}`);
  }
}

// Reads these calls from Supabase and copies them to Convex, then the pending counts, then
// bumps "calls", "attention", "suppliers" (its page lists every call), each call's section and
// opts.topics. With opts.onlyIfChanged (the status route, polled every few seconds) nothing is
// bumped unless a call or the counts actually changed.
export async function syncCalls(
  db: Db,
  ids: (number | null | undefined)[],
  opts: { topics?: Topic[]; onlyIfChanged?: boolean } = {},
  deps: LiveDeps = defaultDeps,
): Promise<void> {
  const client = clientOf(deps);
  if (!client) return;
  const wanted = [...new Set(ids.filter((id): id is number => typeof id === "number" && id > 0))];
  const bumped = new Set<Topic>(["calls", "attention", "suppliers", ...(opts.topics ?? [])]);
  let changed = false;
  try {
    if (wanted.length) {
      const res = await db.from("call_requests").select(LIVE_COLUMNS).eq("restaurant_id", RESTAURANT_ID).in("id", wanted);
      if (res.error) throw new Error(`load calls: ${res.error.message}`);
      for (const row of (res.data ?? []) as LiveSource[]) {
        if ((await send(deps, client, api.live.upsertCall, { call: toLiveCall(row) })) !== false) changed = true;
        bumped.add(callSection(row.context_type));
      }
    }
    const counts: PendingCounts = await pendingCounts(db);
    if ((await send(deps, client, api.live.setCounts, { restaurantId: RESTAURANT_ID, counts })) !== false) changed = true;
  } catch (err) {
    deps.log(`[live] syncCalls ${wanted.join(",")} failed: ${message(err)}`);
    changed = true; // can't tell: let the screens reload
  }
  if (changed || !opts.onlyIfChanged) await bump([...bumped], deps);
}

export type ResyncResult = { ok: true; calls: number } | { ok: false; reason: string };

// Every call from the last 7 days plus any still open, and the counts; all topics bumped.
export async function resyncAll(db: Db, deps: LiveDeps = defaultDeps, now = new Date()): Promise<ResyncResult> {
  const client = clientOf(deps);
  if (!client) return { ok: false, reason: "convex not configured" };
  try {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await db
      .from("call_requests")
      .select(LIVE_COLUMNS)
      .eq("restaurant_id", RESTAURANT_ID)
      .or(`created_at.gte.${since},status.in.(${OPEN_STATUSES.join(",")})`)
      .order("id", { ascending: false })
      .limit(500);
    if (res.error) throw new Error(`load calls: ${res.error.message}`);
    const calls = ((res.data ?? []) as LiveSource[]).map((row) => toLiveCall(row, now.getTime()));
    const counts = await pendingCounts(db);
    await send(deps, client, api.live.resync, { restaurantId: RESTAURANT_ID, calls, counts });
    return { ok: true, calls: calls.length };
  } catch (err) {
    deps.log(`[live] resync failed: ${message(err)}`);
    return { ok: false, reason: message(err) };
  }
}

// For write routes: bump the route's topics (ROUTE_TOPICS) after the response is sent.
export function signalAfter(route: LiveRoute) {
  if (liveEnabled()) after(() => bump(ROUTE_TOPICS[route]));
}

const POLLED_ROUTE: LiveRoute = "/api/calls/[id]/status";

// For routes that change supplier calls: sync those calls after the response is sent.
export function syncCallsAfter(db: Db, ids: (number | null | undefined)[], route: LiveRoute) {
  if (liveEnabled()) after(() => syncCalls(db, ids, { topics: ROUTE_TOPICS[route], onlyIfChanged: route === POLLED_ROUTE }));
}
