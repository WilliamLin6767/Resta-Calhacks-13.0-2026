// The agent's write tools with every service mocked: an ask writes nothing, and the happy path
// calls the route's service once with the right arguments and returns a change.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  loadInventory: vi.fn(),
  saveCounts: vi.fn(),
  logWaste: vi.fn(),
  loadMenu: vi.fn(),
  saveReceipt: vi.fn(),
  confirmLine: vi.fn(),
  recheckInvoice: vi.fn(),
  loadOrders: vi.fn(),
  latestDispute: vi.fn(),
  saveDraft: vi.fn(),
  draftRestock: vi.fn(),
  draftPlan: vi.fn(),
  createOwnerRequest: vi.fn(),
  scanForCalls: vi.fn(),
  listCalls: vi.fn(),
  loadBar: vi.fn(),
  dismiss: vi.fn(),
  loadPricing: vi.fn(),
  applyDeliveryPrices: vi.fn(),
  refreshUsda: vi.fn(),
  refreshThomasNet: vi.fn(),
  reportLimit: vi.fn(),
  runReport: vi.fn(),
  signalAfter: vi.fn(),
  syncCallsAfter: vi.fn(),
}));

vi.mock("@/lib/inventory/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/inventory/service")>()),
  loadInventory: m.loadInventory,
  saveCounts: m.saveCounts,
  logWaste: m.logWaste,
  todayLocal: () => "2026-10-24",
}));
vi.mock("@/lib/sales/service", () => ({ loadMenu: m.loadMenu, saveReceipt: m.saveReceipt }));
vi.mock("@/lib/purchasing/service", () => ({ confirmLine: m.confirmLine, recheckInvoice: m.recheckInvoice, loadOrders: m.loadOrders }));
vi.mock("@/lib/purchasing/disputeService", () => ({ latestDispute: m.latestDispute, saveDraft: m.saveDraft }));
vi.mock("@/lib/purchasing/restock", async (orig) => ({ ...(await orig<typeof import("@/lib/purchasing/restock")>()), draftRestock: m.draftRestock }));
vi.mock("@/lib/purchasing/planService", () => ({ draftPlan: m.draftPlan }));
vi.mock("@/lib/calls/service", () => ({ createOwnerRequest: m.createOwnerRequest, scanForCalls: m.scanForCalls, listCalls: m.listCalls, supabaseStore: () => ({ get: vi.fn() }) }));
vi.mock("@/lib/attention/service", () => ({ loadBar: m.loadBar, dismiss: m.dismiss }));
vi.mock("@/lib/pricing/service", async (orig) => ({ ...(await orig<typeof import("@/lib/pricing/service")>()), loadPricing: m.loadPricing, applyDeliveryPrices: m.applyDeliveryPrices }));
vi.mock("@/lib/market/refresh", () => ({ refreshUsda: m.refreshUsda, refreshThomasNet: m.refreshThomasNet }));
vi.mock("@/lib/analyticsReport", () => ({ reportLimit: m.reportLimit, runReport: m.runReport }));
vi.mock("@/lib/live/signal", () => ({ signalAfter: m.signalAfter, syncCallsAfter: m.syncCallsAfter }));
vi.mock("@/app/analytics/data", () => ({ loadAnalytics: vi.fn(async () => ({ error: "not in tests" })) }));

const { AGENT_TOOLS, buildTools, createCtx, toolsFor } = await import("@/lib/agent/registry");
type Ctx = ReturnType<typeof createCtx>;

// A Supabase stand-in: every filter returns the query, awaiting it gives the table's rows,
// single()/maybeSingle() the first row, and update() is recorded.
function fakeDb(tables: Record<string, unknown[]> = {}) {
  const updates: { table: string; values: unknown }[] = [];
  const query = (table: string, write = false): Record<string, unknown> => {
    const rows = tables[table] ?? [];
    const q: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "is", "neq", "gte", "lt", "order", "limit", "or"]) q[name] = () => q;
    q.single = async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } });
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    q.update = (values: unknown) => {
      updates.push({ table, values });
      return query(table, true);
    };
    q.then = (resolve: (v: unknown) => unknown) => resolve(write ? { data: null, error: null } : { data: rows, error: null });
    return q;
  };
  return { db: { from: (table: string) => query(table) } as unknown as SupabaseClient, updates };
}

function ctxWith(tables: Record<string, unknown[]> = {}, extra: Partial<Ctx> = {}) {
  const fake = fakeDb(tables);
  return { ctx: { ...createCtx({ db: fake.db, surface: "chat", identity: `test-${Math.random()}` }), ...extra }, updates: fake.updates };
}

async function run(name: string, input: unknown, ctx: Ctx) {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const out = await tool.run(input as never, ctx);
  return out.startsWith("Error") ? { error: out } : JSON.parse(out);
}

const line = (id: number, name: string, unit: string, estimated: number, par: number | null) => ({
  id, name, unit, category: "produce", current_qty: estimated, par_level: par, reorder_point: null,
  last_counted: null, used_since: 0, estimated, daily_use: 1, days_left: 3, status: "ok",
});
const inventory = {
  lines: [line(1, "Limes", "lb", 8, 20), line(2, "Yellow onion", "lb", 10, 30), line(3, "Green onion", "bunch", 4, 10), line(4, "Beef bones", "lb", 50, 100)],
  packQty: { 1: 30 },
  sources: { 1: { pack_desc: "30 lb case" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.loadInventory.mockResolvedValue(inventory);
  m.saveCounts.mockResolvedValue(1);
  m.logWaste.mockResolvedValue(1);
});

describe("set_stock_count", () => {
  it("asks which onion and writes nothing", async () => {
    const { ctx } = ctxWith();
    const r = await run("set_stock_count", { items: [{ ingredient: "limes", amount: 12 }, { ingredient: "onion", amount: 5 }] }, ctx);
    expect(r).toEqual({ ok: false, ask: "Which one: Yellow onion or Green onion?" });
    expect(m.saveCounts).not.toHaveBeenCalled();
    expect(ctx.changes).toEqual([]);
  });

  it("asks before saving an odd count, and saves it once confirmed", async () => {
    const { ctx } = ctxWith();
    expect((await run("set_stock_count", { items: [{ ingredient: "limes", amount: 500 }] }, ctx)).ask).toContain("Did you mean 500 lb of Limes?");
    expect(m.saveCounts).not.toHaveBeenCalled();
    await run("set_stock_count", { items: [{ ingredient: "limes", amount: 500 }], confirm: true }, ctx);
    expect(m.saveCounts).toHaveBeenCalledTimes(1);
  });

  it("saves the counts once, in the ingredient's unit, and says what changed", async () => {
    const { ctx } = ctxWith();
    const r = await run("set_stock_count", { items: [{ ingredient: "lime", amount: 1, unit: "case" }, { ingredient: "beef bones", amount: 60 }] }, ctx);
    expect(m.saveCounts).toHaveBeenCalledTimes(1);
    expect(m.saveCounts).toHaveBeenCalledWith(ctx.db, [{ ingredient_id: 1, qty: 30 }, { ingredient_id: 4, qty: 60 }], "manual");
    expect(r.changes[0]).toMatchObject({ kind: "stock_count", label: "Limes: 8 lb to 30 lb (1 case x 30 lb (30 lb case))", before: 8, after: 30, undo: { kind: "stock_count", ingredient_id: 1, qty: 8 } });
    expect(ctx.changes).toHaveLength(2);
    expect(m.signalAfter).toHaveBeenCalledWith("/api/inventory/counts");
  });

  it("saves voice counts as voice", async () => {
    const { ctx } = ctxWith({}, { spoken: true });
    await run("set_stock_count", { items: [{ ingredient: "limes", amount: 12 }] }, ctx);
    expect(m.saveCounts).toHaveBeenCalledWith(ctx.db, [{ ingredient_id: 1, qty: 12 }], "voice");
  });
});

describe("log_waste", () => {
  it("asks about an unknown food and writes nothing", async () => {
    const { ctx } = ctxWith();
    expect((await run("log_waste", { items: [{ ingredient: "bean sprouts", amount: 3 }] }, ctx)).ok).toBe(false);
    expect(m.logWaste).not.toHaveBeenCalled();
  });
  it("logs it once with the reason", async () => {
    const { ctx } = ctxWith();
    const r = await run("log_waste", { items: [{ ingredient: "limes", amount: 3, unit: "lb", reason: "spoiled" }] }, ctx);
    expect(m.logWaste).toHaveBeenCalledWith(ctx.db, [{ ingredient_id: 1, qty: 3, reason: "spoiled" }], "manual");
    expect(r.changes[0]).toMatchObject({ kind: "waste", label: "Limes: 3 lb thrown out (spoiled), 8 to 5 lb", undo: { kind: "waste", qty: 8 } });
  });
});

describe("record_sale", () => {
  beforeEach(() => {
    m.loadMenu.mockResolvedValue([{ id: 1, name: "Pho Tai", price: 14.5 }, { id: 2, name: "Banh Mi", price: 9 }]);
    m.saveReceipt.mockResolvedValue({ order_id: 7, impact: [], alerts: [] });
  });
  it("asks about a dish it can't find", async () => {
    const { ctx } = ctxWith();
    expect((await run("record_sale", { dishes: [{ dish: "taco", qty: 1 }] }, ctx)).ok).toBe(false);
    expect(m.saveReceipt).not.toHaveBeenCalled();
  });
  it("saves one receipt with menu prices unless one is given", async () => {
    const { ctx } = ctxWith();
    const r = await run("record_sale", { dishes: [{ dish: "pho", qty: 2 }, { dish: "banh mi", qty: 1, price: 10 }] }, ctx);
    expect(m.saveReceipt).toHaveBeenCalledTimes(1);
    const [, receipt, source] = m.saveReceipt.mock.calls[0];
    expect(source).toBe("manual");
    expect(receipt).toMatchObject({ date: "2026-10-24", channel: "dine_in", lines: [{ menu_item_id: 1, qty: 2, unit_price: 14.5 }, { menu_item_id: 2, qty: 1, unit_price: 10 }], total: 39 });
    expect(r.change.label).toBe("Sale added: 2 x Pho Tai, 1 x Banh Mi ($39.00)");
  });
});

describe("invoice tools", () => {
  const invoices = [
    { id: 14, invoice_number: "SY-881", invoice_date: "2026-10-18", total: 100, status: "approved", suppliers: { name: "Sysco" }, invoice_flags: [] },
    { id: 15, invoice_number: "SY-902", invoice_date: "2026-10-23", total: 200, status: "approved", suppliers: { name: "Sysco" }, invoice_flags: [{ money_impact: 12, resolved: false }] },
  ];

  it("confirm_invoice_line asks which onion, then confirms once", async () => {
    const tables = { invoice_lines: [{ id: 5, description: "ONION YLW 50#" }], ingredients: inventory.lines.map(({ id, name }) => ({ id, name })) };
    const a = ctxWith(tables);
    expect((await run("confirm_invoice_line", { line_id: 5, ingredient: "onion" }, a.ctx)).ok).toBe(false);
    expect(m.confirmLine).not.toHaveBeenCalled();
    m.confirmLine.mockResolvedValue(15);
    const r = await run("confirm_invoice_line", { line_id: 5, ingredient: "yellow onion" }, a.ctx);
    expect(m.confirmLine).toHaveBeenCalledWith(a.ctx.db, 5, { ingredient_id: 2, new_ingredient_name: undefined, new_ingredient_unit: undefined });
    expect(r.change.label).toBe('Invoice line "ONION YLW 50#": now Yellow onion');
  });

  it("resolve_invoice_flag writes once, and nothing for an unknown flag", async () => {
    const none = ctxWith();
    expect((await run("resolve_invoice_flag", { flag_id: 9 }, none.ctx)).error).toContain("Unknown flag");
    expect(none.updates).toEqual([]);
    const one = ctxWith({ invoice_flags: [{ id: 9, message: "Brisket billed $11 over", resolved: false }] });
    const r = await run("resolve_invoice_flag", { flag_id: 9 }, one.ctx);
    expect(one.updates).toEqual([{ table: "invoice_flags", values: { resolved: true } }]);
    expect(r.change.label).toBe("Resolved: Brisket billed $11 over");
  });

  it("check_invoice asks about an unknown invoice, and re-checks the latest Sysco one once", async () => {
    const { ctx } = ctxWith({ invoices });
    expect((await run("check_invoice", { invoice: "Valley Butcher" }, ctx)).ok).toBe(false);
    expect(m.recheckInvoice).not.toHaveBeenCalled();
    m.recheckInvoice.mockResolvedValue([{}, {}]);
    const r = await run("check_invoice", { invoice: "the latest Sysco invoice" }, ctx);
    expect(m.recheckInvoice).toHaveBeenCalledWith(ctx.db, 15);
    expect(r.change.label).toBe("Sysco invoice SY-902 checked: 2 problems found");
  });

  it("save_dispute_draft asks which Sysco invoice, then saves only the fields given", async () => {
    const { ctx } = ctxWith({ invoices });
    expect((await run("save_dispute_draft", { invoice: "sysco", subject: "x" }, ctx)).ok).toBe(false);
    expect(m.saveDraft).not.toHaveBeenCalled();
    m.latestDispute.mockResolvedValue({ id: 3, status: "draft", to_email: "ar@sysco.com", subject: "Invoice SY-902", body: "Hello" });
    await run("save_dispute_draft", { invoice: "SY-902", subject: "Credit for invoice SY-902" }, ctx);
    expect(m.saveDraft).toHaveBeenCalledWith(ctx.db, 3, { to_email: "ar@sysco.com", subject: "Credit for invoice SY-902", body: "Hello" });
  });
});

describe("drafts and calls", () => {
  it("draft_restock keeps the order for the Approve button, and reports a non-draft as is", async () => {
    const { ctx } = ctxWith();
    m.draftRestock.mockResolvedValueOnce({ drafted: false, reason: "Limes is not low enough to restock." });
    expect(await run("draft_restock", { ingredient: "limes" }, ctx)).toEqual({ drafted: false, reason: "Limes is not low enough to restock." });
    expect(ctx.changes).toEqual([]);
    const order = { drafted: true, orderId: 21, supplier: "Delta Fresh Produce", total: 42, lines: [] };
    m.draftRestock.mockResolvedValueOnce(order);
    const r = await run("draft_restock", { ingredient: "limes" }, ctx);
    expect(m.draftRestock).toHaveBeenLastCalledWith(ctx.db, "limes");
    expect(ctx.order).toEqual(order);
    expect(r.change.label).toBe("Draft order #21 to Delta Fresh Produce, $42.00 (waiting for your OK)");
  });

  it("draft_order_plan drafts the low-stock plan once, and refuses a bad day", async () => {
    const { ctx } = ctxWith();
    expect((await run("draft_order_plan", { kind: "prep", day: "someday" }, ctx)).error).toBeDefined();
    expect(m.draftPlan).not.toHaveBeenCalled();
    m.draftPlan.mockResolvedValue([31, 32]);
    const r = await run("draft_order_plan", { kind: "low" }, ctx);
    expect(m.draftPlan).toHaveBeenCalledWith(ctx.db, { kind: "low", exclude: [] });
    expect(r.change.label).toBe("Drafted 2 orders (#31, #32), waiting for your OK");
  });

  it("propose_call asks about an unknown supplier, then adds one pending request (never dials)", async () => {
    const { ctx } = ctxWith({ suppliers: [{ id: 2, name: "Valley Butcher Supply" }, { id: 3, name: "Bay Area Meat Co." }] });
    expect((await run("propose_call", { supplier: "Sysco", request: "ask about Saturday" }, ctx)).ok).toBe(false);
    expect(m.createOwnerRequest).not.toHaveBeenCalled();
    m.createOwnerRequest.mockResolvedValue({ id: 40, title: "Ask about Saturday delivery" });
    const r = await run("propose_call", { supplier: "valley butcher", request: "ask about Saturday delivery" }, ctx);
    expect(m.createOwnerRequest).toHaveBeenCalledWith(ctx.db, { supplier_id: 2, text: "ask about Saturday delivery" }, "ai");
    expect(m.syncCallsAfter).toHaveBeenCalledWith(ctx.db, [40], "/api/calls/request");
    expect(r.change.label).toContain("nothing dialed");
    expect((await run("propose_call", { supplier: "valley butcher", request: "again" }, ctx)).error).toContain("already proposed");
  });

  it("scan_for_calls scans once", async () => {
    const { ctx } = ctxWith();
    m.scanForCalls.mockResolvedValue({ created: [{ id: 41, title: "Dispute $171" }], considered: 3, noPhone: [] });
    const r = await run("scan_for_calls", {}, ctx);
    expect(m.scanForCalls).toHaveBeenCalledTimes(1);
    expect(r.change.label).toBe("Found 1 call to approve: Dispute $171");
  });
});

describe("other writes", () => {
  // Phase 2 renamed dismiss_needs_you to dismiss_finding (same behavior)
  it("dismiss_finding asks which finding, then hides one", async () => {
    const item = (key: string, title: string) => ({ key, fingerprint: `${key}-fp`, tab: "inventory", level: "watch", title, actions: [], dismissable: true });
    m.loadBar.mockResolvedValue({ items: [item("low:1", "Limes are low"), item("low:2", "Onions are low")] });
    const { ctx } = ctxWith();
    expect((await run("dismiss_finding", { item: "low", tab: "inventory" }, ctx)).ok).toBe(false);
    expect(m.dismiss).not.toHaveBeenCalled();
    await run("dismiss_finding", { item: "limes are low", tab: "inventory" }, ctx);
    expect(m.dismiss).toHaveBeenCalledWith(ctx.db, "low:1", "low:1-fp");
  });

  // Phase 2 changed this on purpose: raising delivery prices changes real prices, so it is no
  // longer a tool that runs right away (it comes back in Phase 3 as a Commit proposal).
  it("refresh_delivery_prices is no longer a tool", () => {
    expect(AGENT_TOOLS.some((t) => t.name === "refresh_delivery_prices")).toBe(false);
  });

  it("refresh_market_prices runs only the one asked for", async () => {
    const { ctx } = ctxWith();
    m.refreshUsda.mockResolvedValue({ ok: true, body: { stored: 12 } });
    await run("refresh_market_prices", { which: "usda" }, ctx);
    expect(m.refreshUsda).toHaveBeenCalledWith(ctx.db, ctx.identity);
    expect(m.refreshThomasNet).not.toHaveBeenCalled();
  });

  it("run_analytics_report stops at the rate limit, and runs once otherwise", async () => {
    const { ctx } = ctxWith();
    m.reportLimit.mockReturnValueOnce({ ok: false, status: 429, error: "Too many" });
    expect((await run("run_analytics_report", { days: 30 }, ctx)).error).toBe("Error: Too many");
    expect(m.runReport).not.toHaveBeenCalled();
    m.reportLimit.mockReturnValueOnce(null);
    m.runReport.mockResolvedValue({ ok: true, body: { report: {}, cached: false } });
    await run("run_analytics_report", { days: 7 }, ctx);
    expect(m.runReport).toHaveBeenCalledWith(ctx.db, 7);
  });

  it("open_page adds a link, once", async () => {
    const { ctx } = ctxWith();
    await run("open_page", { page: "invoices", reason: "to scan the invoice" }, ctx);
    await run("open_page", { page: "invoices", reason: "again" }, ctx);
    expect(ctx.links).toEqual([{ href: "/invoices", label: "Invoices", reason: "to scan the invoice" }]);
  });
});

describe("undo_change", () => {
  const undo = { kind: "stock_count", ingredient_id: 1, qty: 8, name: "Limes", unit: "lb" } as const;
  it("refuses a payload that isn't in this conversation's changes", async () => {
    const { ctx } = ctxWith();
    expect((await run("undo_change", { undo }, ctx)).error).toContain("isn't one from this conversation");
    expect((await run("undo_change", { undo: { ...undo, qty: 999 } }, { ...ctx, history: [{ kind: "stock_count", label: "x", before: 8, after: 12, undo }] })).error).toBeDefined();
    expect(m.saveCounts).not.toHaveBeenCalled();
  });
  it("sets the stock back when the change is in the history", async () => {
    const { ctx } = ctxWith({}, { history: [{ kind: "stock_count", label: "Limes: 8 lb to 12 lb", before: 8, after: 12, undo }] });
    const r = await run("undo_change", { undo }, ctx);
    expect(m.saveCounts).toHaveBeenCalledWith(ctx.db, [{ ingredient_id: 1, qty: 8 }], "manual");
    expect(r.change.label).toBe("Undone: Limes back to 8 lb");
  });
});

describe("buildTools", () => {
  it("has unique names, and every tool has a description", () => {
    const tools = buildTools(createCtx({ db: fakeDb().db, surface: "chat", identity: "x" }));
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of tools) expect((t as { description?: string }).description?.length ?? 0, t.name).toBeGreaterThan(20);
    for (const name of ["get_dashboard_summary", "set_stock_count", "log_waste", "propose_call", "open_page", "undo_change"]) expect(names).toContain(name);
  });

  // Phase 3 added the Commit tools (proposals only); the loop still can't see them (below).
  it("gives every tool a tier and an area, and the Commit tools are the approval gate's", () => {
    for (const t of AGENT_TOOLS) {
      expect(["read", "draft", "record", "commit"], t.name).toContain(t.tier);
      expect(t.area, t.name).toBeTruthy();
    }
    expect(AGENT_TOOLS.filter((t) => t.tier === "commit").map((t) => t.name)).toEqual(expect.arrayContaining(["place_call", "set_menu_price", "publish_post", "approve_purchase_order"]));
  });

  it("gives the loop surface only read and draft tools", () => {
    const loop = toolsFor("loop");
    expect(loop.length).toBeGreaterThan(10);
    expect(loop.filter((t) => t.tier !== "read" && t.tier !== "draft").map((t) => t.name)).toEqual([]);
    const names = buildTools(createCtx({ db: fakeDb().db, surface: "loop", identity: "x" })).map((t) => t.name);
    for (const name of ["set_stock_count", "log_waste", "record_sale", "undo_change", "dismiss_finding"]) expect(names).not.toContain(name);
    for (const name of ["profit_opportunities", "restock_options", "draft_restock", "propose_call"]) expect(names).toContain(name);
  });

  it("shows charts only on the panel", () => {
    expect(toolsFor("panel").map((t) => t.name)).toContain("show_chart");
    for (const s of ["chat", "voice", "loop"] as const) expect(toolsFor(s).map((t) => t.name)).not.toContain("show_chart");
  });

  it("turns a thrown error into Error text instead of throwing", async () => {
    m.loadInventory.mockRejectedValueOnce(new Error("Supabase is down"));
    const tool = buildTools(createCtx({ db: fakeDb().db, surface: "chat", identity: "x" })).find((t) => t.name === "list_inventory")!;
    await expect(tool.run({})).resolves.toBe("Error: Supabase is down");
  });
});
