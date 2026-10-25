// The approval gate: proposals, approving exactly once, limits at execute time, expiry and reject.
import { readdirSync, readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ changePrice: vi.fn(), moveToSavings: vi.fn(), setReserve: vi.fn(), signalAfter: vi.fn() }));
vi.mock("@/lib/pricing/service", async (orig) => ({ ...(await orig<typeof import("@/lib/pricing/service")>()), changePrice: m.changePrice }));
vi.mock("@/lib/bank/cashPlan", () => ({ moveToSavings: m.moveToSavings, loadMoney: vi.fn() }));
vi.mock("@/lib/bank/service", () => ({ setReserve: m.setReserve, loadBank: vi.fn() }));
vi.mock("@/lib/live/signal", () => ({ signalAfter: m.signalAfter, syncCallsAfter: vi.fn(), signalAction: vi.fn() }));

const { actNow, approve, execute, propose, reject, ActionError } = await import("@/lib/agent/actions");
const { executorsFor, COMMIT_TOOLS } = await import("@/lib/agent/executors");
const { AGENT_TOOLS, createCtx } = await import("@/lib/agent/registry");
type ActionRow = import("@/lib/agent/actions").ActionRow;
type ActionStore = import("@/lib/agent/actions").ActionStore;

// An in-memory store with the same conditional update as Supabase. Each update yields first, so
// two concurrent calls really interleave.
function memoryStore() {
  const rows = new Map<number, ActionRow>();
  let next = 1;
  const store: ActionStore = {
    async insert(row) {
      const made: ActionRow = {
        id: next++, restaurant_id: 1, case_id: null, tier: "commit", evidence: [], impact: null, surface: null,
        status: "proposed", approved_at: null, approved_by: null, result: null, error: null,
        created_at: new Date().toISOString(), done_at: null, expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
        ...row,
      } as ActionRow;
      rows.set(made.id, made);
      return made;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async update(id, from, patch, notExpiredAt) {
      await Promise.resolve();
      const row = rows.get(id);
      if (!row || !from.includes(row.status)) return null;
      if (notExpiredAt && row.expires_at <= notExpiredAt) return null;
      const updated = { ...row, ...patch } as ActionRow;
      rows.set(id, updated);
      return updated;
    },
    async list() {
      return [...rows.values()];
    },
  };
  return { store, rows };
}

const counted = () => {
  const run = vi.fn(async () => ({ ok: 1 }));
  return { run, executors: { test_action: run } };
};

beforeEach(() => vi.clearAllMocks());

describe("propose", () => {
  it("only records a proposal, for a tool that has an executor", async () => {
    const { store } = memoryStore();
    const { run, executors } = counted();
    const row = await propose(store, { tool: "test_action", title: "t", summary: "s", args: {}, source: "agent" }, executors);
    expect(row.status).toBe("proposed");
    expect(run).not.toHaveBeenCalled();
    await expect(propose(store, { tool: "drop_tables", title: "t", summary: "s", args: {}, source: "agent" }, executors)).rejects.toBeInstanceOf(ActionError);
  });

  it("the model's Commit tools only insert a proposed row, and never import the gate or the routes", async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => {
          inserted.push({ table, ...row });
          return { select: () => ({ single: async () => ({ data: { id: 7, status: "proposed", ...row }, error: null }) }) };
        },
      }),
    } as unknown as SupabaseClient;
    const ctx = createCtx({ db, surface: "chat", identity: "x" });
    const tool = AGENT_TOOLS.find((t) => t.name === "bank_savings")!;
    const out = JSON.parse(await tool.run({ amount: 500 }, ctx));
    expect(out.proposed.action_id).toBe(7);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ table: "agent_actions", tool: "bank_savings", source: "agent", surface: "chat", args: { amount: 500 } });
    expect(inserted[0].status).toBeUndefined(); // the table's default: proposed
    expect(m.moveToSavings).not.toHaveBeenCalled();
    expect(ctx.proposals).toEqual([expect.objectContaining({ action_id: 7, tool: "bank_savings" })]);

    // Every Commit tool has an executor, and no tool file can reach approve or execute
    const commitNames = AGENT_TOOLS.filter((t) => t.tier === "commit").map((t) => t.name).sort();
    expect(commitNames.every((n) => COMMIT_TOOLS.includes(n))).toBe(true);
    const dir = new URL("../agent/tools/", import.meta.url);
    for (const file of readdirSync(dir)) {
      const src = readFileSync(new URL(file, dir), "utf8");
      expect(src, file).not.toMatch(/agent\/gate|from "\.\.\/gate"|app\/api\/actions|\bapprove\(|\bexecute\(/);
    }
  });
});

describe("approve and execute", () => {
  it("runs the executor exactly once, even with two approvals at the same time", async () => {
    const { store, rows } = memoryStore();
    const { run, executors } = counted();
    const row = await propose(store, { tool: "test_action", title: "t", summary: "s", args: {}, source: "agent" }, executors);
    const tap = async () => {
      await approve(store, row.id, "owner:a");
      return execute(store, row.id, executors);
    };
    const results = await Promise.allSettled([tap(), tap()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.status)).toEqual([409]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(rows.get(row.id)!.status).toBe("done");

    // A second execute of the same approved action doesn't run it again
    await execute(store, row.id, executors);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("can't approve an expired proposal", async () => {
    const { store, rows } = memoryStore();
    const { run, executors } = counted();
    const row = await propose(store, { tool: "test_action", title: "t", summary: "s", args: {}, source: "agent" }, executors);
    rows.set(row.id, { ...rows.get(row.id)!, expires_at: new Date(Date.now() - 1000).toISOString() });
    await expect(approve(store, row.id, "owner:a")).rejects.toMatchObject({ status: 410 });
    expect(rows.get(row.id)!.status).toBe("expired");
    await execute(store, row.id, executors);
    expect(run).not.toHaveBeenCalled();
  });

  it("reject leaves the target untouched", async () => {
    const { store, rows } = memoryStore();
    const executors = executorsFor({} as SupabaseClient);
    const row = await propose(store, { tool: "bank_savings", title: "t", summary: "s", args: { amount: 500 }, source: "agent" }, executors);
    await reject(store, row.id, "owner:a");
    expect(rows.get(row.id)!.status).toBe("rejected");
    await expect(approve(store, row.id, "owner:a")).rejects.toMatchObject({ status: 409 });
    expect(m.moveToSavings).not.toHaveBeenCalled();
  });
});

describe("limits at execute time", () => {
  const menuDb = (price: number) =>
    ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Pho Tai", price }, error: null }) }) }) }) }) }) as unknown as SupabaseClient;

  it("blocks an agent's price change over 10%, and a bad money move, with a failed action", async () => {
    const { store, rows } = memoryStore();
    const executors = executorsFor(menuDb(15.95));
    const price = await propose(store, { tool: "set_menu_price", title: "t", summary: "s", args: { menu_item_id: 2, new_price: 18.95 }, source: "agent" }, executors);
    await approve(store, price.id, "owner:a");
    const done = await execute(store, price.id, executors);
    expect(done.status).toBe("failed");
    expect(rows.get(price.id)!.error).toContain("limit is 10%");
    expect(m.changePrice).not.toHaveBeenCalled();

    const move = await propose(store, { tool: "bank_savings", title: "t", summary: "s", args: { amount: -5 }, source: "agent" }, executors);
    await approve(store, move.id, "owner:a");
    expect((await execute(store, move.id, executors)).status).toBe("failed");
    expect(m.moveToSavings).not.toHaveBeenCalled();
  });

  it("lets a change within the limit through, and the owner's own price edit isn't capped", async () => {
    const { store } = memoryStore();
    const executors = executorsFor(menuDb(15.95));
    const ok = await propose(store, { tool: "set_menu_price", title: "t", summary: "s", args: { menu_item_id: 2, new_price: 16.95 }, source: "agent" }, executors);
    await approve(store, ok.id, "owner:a");
    expect((await execute(store, ok.id, executors)).status).toBe("done");
    expect(m.changePrice).toHaveBeenCalledWith(expect.anything(), 2, 16.95, "");

    const { action } = await actNow(store, { tool: "set_menu_price", title: "t", summary: "s", args: { menu_item_id: 2, new_price: 21 } }, "owner:a", executors);
    expect(action?.status).toBe("done");
    expect(action?.source).toBe("owner");
  });

  it("an owner button's failure throws the original error, after logging it as failed", async () => {
    const { store, rows } = memoryStore();
    const boom = new Error("Nessie is down");
    const executors = { bank_savings: async () => Promise.reject(boom) };
    await expect(actNow(store, { tool: "bank_savings", title: "t", summary: "s", args: { amount: 5 } }, "owner:a", executors)).rejects.toBe(boom);
    expect([...rows.values()][0]).toMatchObject({ status: "failed", error: "Nessie is down", source: "owner" });
  });
});

describe("place_call summary", () => {
  it("says what the caller may agree to in words, never [object Object]", async () => {
    const { limitsText } = await import("@/lib/agent/tools/commit");
    expect(limitsText({ min_credit: 0, max_packs: 0, max_total: 0, notes: "This is an information call only." })).toBe("It can't agree to buy or pay anything. This is an information call only.");
    expect(limitsText({ min_credit: 150, max_packs: 0, max_total: 0, notes: "" })).toBe("It may accept a credit of at least $150.00.");
    expect(limitsText({ min_credit: 0, max_packs: 4, max_total: 336, notes: "No standing order" })).toBe("It may order up to 4 packs, spend up to $336.00. No standing order.");
  });
});
