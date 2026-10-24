import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOPICS } from "@/convex/topics";
import { CALL_STATUSES, type CallRow } from "@/lib/calls/types";
import { mergeLiveCalls } from "@/lib/live/mergeCalls";
import { createRefreshGate } from "@/lib/live/refreshGate";
import { ROUTE_TOPICS } from "@/lib/live/routeTopics";
import { bump, syncCalls, toLiveCall, type LiveClient, type LiveDeps } from "@/lib/live/signal";

const row: CallRow = {
  id: 7,
  restaurant_id: 1,
  supplier_id: 3,
  context_type: "invoice",
  context_id: 12,
  purpose: "dispute",
  title: "Ask Valley Butcher about the brisket overcharge",
  reason: "Billed $40 over the agreed price",
  brief: {
    goal: "Get a $40 credit",
    ask_for: "",
    facts: ["Invoice 1042 billed brisket at $6.10/lb"],
    questions: [],
    wanted_by: "",
    limits: { min_credit: 40, max_packs: 0, max_total: 0, notes: "" },
    refs: { invoice_id: 12, flag_ids: [4] },
  },
  status: "calling",
  proposed_by: "ai",
  wajo_call_id: "conv_123",
  dialed_number: "+15105550123",
  progress: "On the call",
  question: null,
  last_polled_at: null,
  outcome: null,
  result: { stage: "summarizing", dial: { dial: "+15105550123", supplier_number: "+15105550123", override: false }, credit_amount: 40 },
  transcript: "Fo: Hello, this is an AI calling for the restaurant...",
  created_at: "2026-10-24T10:00:00Z",
  decided_at: "2026-10-24T10:01:00Z",
  completed_at: null,
  error: null,
};

describe("toLiveCall", () => {
  it("keeps only what the panel shows: no transcript, brief, phone number or money", () => {
    const call = toLiveCall(row, 1000);
    expect(call).toEqual({
      callId: 7,
      restaurantId: 1,
      contextType: "invoice",
      contextId: 12,
      supplierId: 3,
      status: "calling",
      progress: "On the call",
      stage: "summarizing",
      updatedAt: 1000,
    });
    const sent = JSON.stringify(call);
    for (const secret of ["5550123", "Fo: Hello", "brisket", "credit", "conv_123", "brief", "transcript"]) expect(sent).not.toContain(secret);
  });

  it("maps every status as it is, and leaves out empty fields", () => {
    for (const status of CALL_STATUSES) {
      const call = toLiveCall({ ...row, status, progress: null, result: null, outcome: status === "completed" ? "They'll credit $40." : null });
      expect(call.status).toBe(status);
      expect("progress" in call).toBe(false);
      expect("stage" in call).toBe(false);
      expect("outcome" in call).toBe(status === "completed");
    }
  });
});

// ---------------------------------------------------------------------
// Signalling with a fake Convex client and a fake Supabase
// ---------------------------------------------------------------------

// A Supabase query builder: every filter returns itself, awaiting it gives the table's rows.
function fakeDb(tables: Record<string, unknown[]>) {
  const from = vi.fn((table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      or: () => q,
      order: () => q,
      limit: () => q,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [], error: null }),
    };
    return q;
  });
  return { from } as unknown as Parameters<typeof syncCalls>[0] & { from: typeof from };
}

const pending = [{ context_type: "ingredient", context_id: 5, supplier_id: 3 }];

function deps(client: LiveClient | null, timeoutMs = 50) {
  const log = vi.fn();
  const d: LiveDeps = { client: () => client, secret: () => "test-secret", timeoutMs, log };
  return { d, log };
}

const nameOf = (ref: unknown) => getFunctionName(ref as FunctionReference<"mutation">);

describe("syncCalls and bump", () => {
  it("copy the calls and counts, then bump calls, attention and the call's section", async () => {
    const mutation = vi.fn(async () => true);
    const { d, log } = deps({ mutation } as unknown as LiveClient);
    await syncCalls(fakeDb({ call_requests: [row] }), [7, 7, null], {}, d);
    const calls = mutation.mock.calls as unknown as [unknown, Record<string, unknown>][];
    expect(calls.map(([ref]) => nameOf(ref))).toEqual(["live:upsertCall", "live:setCounts", "live:bump"]);
    expect(calls.every(([, args]) => args.secret === "test-secret")).toBe(true);
    expect(JSON.stringify(calls[0][1])).not.toContain("transcript");
    expect(calls[2][1].topics).toEqual(expect.arrayContaining(["calls", "attention", "invoices"]));
    expect(log).not.toHaveBeenCalled();
  });

  it("a status check that changed nothing bumps nothing", async () => {
    const mutation = vi.fn(async () => false);
    const { d } = deps({ mutation } as unknown as LiveClient);
    await syncCalls(fakeDb({ call_requests: [row] }), [7], { onlyIfChanged: true }, d);
    expect((mutation.mock.calls as unknown as [unknown][]).map(([ref]) => nameOf(ref))).toEqual(["live:upsertCall", "live:setCounts"]);
  });

  it("never throws when Convex throws", async () => {
    const mutation = vi.fn(async () => {
      throw new Error("Not allowed");
    });
    const { d, log } = deps({ mutation } as unknown as LiveClient);
    await expect(syncCalls(fakeDb({ call_requests: [row], call_requests_pending: pending }), [7], {}, d)).resolves.toBeUndefined();
    await expect(bump(["inventory"], d)).resolves.toBeUndefined();
    expect(log.mock.calls.every(([line]) => String(line).startsWith("[live] "))).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  it("gives up on a Convex that doesn't answer", async () => {
    const mutation = vi.fn(() => new Promise(() => {}));
    const { d, log } = deps({ mutation } as unknown as LiveClient, 20);
    const started = Date.now();
    await bump(["inventory", "attention"], d);
    await syncCalls(fakeDb({ call_requests: [row] }), [7], {}, d);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(log.mock.calls.some(([line]) => String(line).includes("timed out"))).toBe(true);
  });

  it("does nothing at all with Convex off", async () => {
    const db = fakeDb({ call_requests: [row] });
    const { d, log } = deps(null);
    await syncCalls(db, [7], {}, d);
    await bump(["inventory"], d);
    expect(db.from).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// Which routes bump what
// ---------------------------------------------------------------------

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });
}

describe("ROUTE_TOPICS", () => {
  const app = join(__dirname, "..", "..", "app");

  it("every write route listed bumps at least one known topic", () => {
    const listed = [
      "/api/calls/scan", "/api/calls/request", "/api/calls/[id]/decide", "/api/calls/[id]/status", "/api/calls/[id]/apply", "/api/assistant",
      "/api/inventory/counts", "/api/inventory/waste", "/api/sales/receipts",
      "/api/invoices/scan", "/api/invoices/[id]/paid", "/api/invoice-lines/[id]/confirm", "/api/invoice-flags/[id]/resolve", "/api/disputes/[id]",
      "/api/purchase-orders/[id]/status", "/api/orders/plan/draft", "/api/price-changes/[id]/updated",
      "/api/menu/delivery-prices", "/api/menu-items/[id]/price", "/api/attention/dismiss", "/api/chat",
    ];
    for (const route of listed) expect(ROUTE_TOPICS, route).toHaveProperty([route]);
    for (const [route, topics] of Object.entries(ROUTE_TOPICS)) {
      expect(topics.length, route).toBeGreaterThan(0);
      for (const t of topics) expect(TOPICS).toContain(t);
    }
  });

  it("each route signals under its own path, and every entry is used by its route", () => {
    const used = new Set<string>();
    for (const file of routeFiles(join(app, "api"))) {
      const path = "/" + file.slice(app.length + 1).replaceAll("\\", "/").replace(/\/route\.ts$/, "");
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n").filter((l) => /signalAfter|syncCallsAfter|ROUTE_TOPICS\[/.test(l) && !l.startsWith("import"));
      for (const [, key] of lines.join("\n").matchAll(/"(\/api\/[^"]+)"/g)) {
        // The invoice scan also syncs the calls its after-scan finds
        expect(key, file).toBe(path === "/api/invoices/scan" && key === "/api/calls/scan" ? key : path);
        used.add(key);
      }
    }
    expect([...used].sort()).toEqual(Object.keys(ROUTE_TOPICS).sort());
  });
});

// ---------------------------------------------------------------------
// <LiveRefresh>: when the page reloads
// ---------------------------------------------------------------------

describe("refresh gate", () => {
  afterEach(() => vi.useRealTimers());

  function gate(state = { hidden: false, typing: false }) {
    const refresh = vi.fn();
    const g = createRefreshGate({ refresh, isHidden: () => state.hidden, isTyping: () => state.typing });
    return { g, refresh, state };
  }

  it("three bumps within 500 ms give one refresh, and the first load gives none", () => {
    vi.useFakeTimers();
    const { g, refresh } = gate();
    g.versions({ inventory: 4, attention: 9 });
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
    g.versions({ inventory: 5, attention: 9 });
    vi.advanceTimersByTime(150);
    g.versions({ inventory: 5, attention: 10 });
    vi.advanceTimersByTime(150);
    g.versions({ inventory: 6, attention: 10 });
    vi.advanceTimersByTime(499);
    expect(refresh).toHaveBeenCalledTimes(1);
    g.versions({ inventory: 6, attention: 10 }); // nothing went up
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("waits for a hidden tab to come back, and for the owner to leave a field", () => {
    vi.useFakeTimers();
    const { g, refresh, state } = gate({ hidden: true, typing: false });
    g.versions({ menu: 1 });
    g.versions({ menu: 2 });
    g.versions({ menu: 3 });
    vi.advanceTimersByTime(600);
    expect(refresh).not.toHaveBeenCalled();
    state.hidden = false;
    state.typing = true;
    g.visible();
    expect(refresh).not.toHaveBeenCalled();
    g.blur(); // focus moved to another field
    expect(refresh).not.toHaveBeenCalled();
    state.typing = false;
    g.blur();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------
// The calls panel folding in what Convex pushes
// ---------------------------------------------------------------------

describe("mergeLiveCalls", () => {
  const live = (status: CallRow["status"], updatedAt: number, extra = {}) => ({ callId: 7, status, updatedAt, ...extra });

  it("ignores the first batch, applies later changes, and reloads when a call finishes or appears", () => {
    const seen = new Map<number, number>();
    const rows = [{ ...row, progress: null }];
    expect(mergeLiveCalls(rows, [live("pending", 1)], seen)).toEqual({ rows, reload: false });

    const step = mergeLiveCalls(rows, [live("calling", 2, { progress: "On the call", stage: "summarizing" })], seen);
    expect(step.reload).toBe(false);
    expect(step.rows[0]).toMatchObject({ status: "calling", progress: "On the call", result: { stage: "summarizing" } });

    expect(mergeLiveCalls(step.rows, [live("calling", 2)], seen).rows).toBe(step.rows); // same update again: nothing to do
    expect(mergeLiveCalls(step.rows, [live("completed", 3, { outcome: "They'll credit $40." })], seen).reload).toBe(true);
    expect(mergeLiveCalls(step.rows, [live("completed", 3), { callId: 8, status: "pending" as const, updatedAt: 4 }], seen).reload).toBe(true);
  });
});
