// The operating picture (lib/intelligence): each cross-department rule fires only when every part
// of the link is in the data, figures match the shared impact formulas, missing and stale sources
// are reported, discoveries are deduplicated and tied to the loop's cases, and the agent's prompt
// carries the same picture under its budget.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { priceRiseImpact } from "@/lib/attention/impact";
import type { Digest, MenuRow, PriceChangeRow } from "@/lib/analytics";
import type { StockLine } from "@/lib/inventory/stock";
import type { CaseRow } from "@/lib/loop/types";
import { billingBeforePayment, cashPressure, costSqueeze, discover, promoWithStock, wastePrep } from "@/lib/intelligence/connect";
import { CONTEXT_BUDGET, contextBlock } from "@/lib/intelligence/context";
import { activity, areaSnapshots, buildPicture } from "@/lib/intelligence/picture";
import type { BillLite, Loaded, MoneyLite, SaleLine, Source } from "@/lib/intelligence/types";
import { systemPrompt } from "@/lib/agent/run";
import { createCtx, toolsFor } from "@/lib/agent/registry";
import type { Picture } from "@/lib/intelligence/types";

// The agent's tool reads the cached picture; here it's the one built in the test.
const held = vi.hoisted(() => ({ picture: null as Picture | null }));
vi.mock("@/lib/intelligence/load", () => ({ loadPicture: async () => held.picture, pictureWithin: async () => held.picture, clearPicture: () => {} }));

const NOW = "2026-10-23T22:00:00.000Z"; // a Friday, 3pm Pacific
const DAY = 86400_000;
const ok = <T,>(data: T): Source<T> => ({ ok: true, data, at: NOW });
const down = <T,>(error = "connection refused"): Source<T> => ({ ok: false, error, at: NOW });

const menuRow = (name: string, over: Partial<MenuRow> = {}): MenuRow => ({
  name, category: "Noodles", price: 16, units: 300, prev_units: 300, units_change_pct: 0, revenue: 4800,
  unit_food_cost: 4, food_cost_pct: 25, unit_margin: 12, gross_profit: 3600, class: "star", ...over,
});

const rise = (over: Partial<PriceChangeRow> = {}): PriceChangeRow => ({
  supplier: "Bay Area Meat Co.", ingredient: "Brisket", previous_price: 100, current_price: 120, change_pct: 20, since: "2026-10-10",
  is_current_supplier: true, dishes: ["Pho Tai"], est_period_impact: null, cheapest_supplier: null, cheapest_unit_cost: null, current_unit_cost: 8, ...over,
});

function digest(over: Partial<Digest> = {}): Digest {
  return {
    version: 2, restaurant: "Pho Berkeley",
    period: { days: 30, start: "2026-09-23", end: "2026-10-22", previous_start: "2026-08-24", previous_end: "2026-09-22" },
    kpis: { cur: { revenue: 60000, orders: 2400, open_days: 30, avg_ticket: 25, revenue_per_open_day: 2000, food_cost: 13000, food_cost_pct: 22, labor: 18000, prime_cost_pct: 52, platform_fees: 1000, fixed_costs: 9000, est_profit: 10000, est_profit_pct: 16.7 } },
    daily: [], by_weekday: [], by_hour: [], channels: [],
    menu: [menuRow("Pho Tai"), menuRow("Bun Bo Hue")],
    menu_thresholds: { popularity_threshold: 100, margin_threshold: 10 },
    costs: { food: 13000, platform_fees: 1000, fixed: {} },
    price_changes: [], notes: [], ...over,
  };
}

const stock = (over: Partial<StockLine> = {}): StockLine => ({
  id: 100, name: "Brisket", unit: "lb", category: "Meat", current_qty: 40, par_level: 40, reorder_point: 10,
  last_counted: "2026-10-23", used_since: 0, estimated: 40, daily_use: 6, days_left: 6.7, status: "ok", ...over,
}) as StockLine;

const money = (over: Partial<MoneyLite> = {}): MoneyLite => ({
  connected: true, balance: 3000, reserve: 1000, lowest: { date: "2026-10-27", balance: 1500 }, first_below: null,
  bills: { overdue: [], due_soon: [], later: [] }, ...over,
});

const bill = (over: Partial<BillLite> = {}): BillLite => ({ id: 12, invoice_number: "BAM-1", supplier: "Bay Area Meat Co.", due_date: "2026-10-30", total: 900, disputed: 0, dispute_status: null, ...over });

const kase = (over: Partial<CaseRow> = {}): CaseRow => ({
  id: 4, restaurant_id: 1, playbook: "supplier_price_rise", finding_key: "price-rise:100", status: "proposed", facts: { title: "Brisket went up" }, evidence: [],
  proposal: { recommendation: "Call the supplier", why: "", action_tools: ["place_call"], action_ids: [31], drafted: [] },
  goal: null, baseline: null, window_start: null, window_end: null, result: null, report: null, lesson: null, error: null, is_demo: false,
  created_at: NOW, updated_at: NOW, closed_at: null, ...over,
});

function loaded(over: Partial<Loaded> = {}): Loaded {
  return {
    now: NOW,
    digest: ok(digest()),
    inventory: ok({ lines: [stock()], wasteWeek: 0 }),
    waste: ok([]),
    sales: ok({ lines: [], dishes: [{ id: 1, name: "Pho Tai" }, { id: 2, name: "Bun Bo Hue" }], recipes: [{ menu_item_id: 1, ingredient_id: 100, qty: 0.5 }] }),
    orders: ok([]),
    money: ok(money()),
    posts: ok([]),
    cases: ok([]),
    actions: ok([]),
    findings: ok([]),
    ...over,
  };
}

// Weekday lunches: `before` plates a day for the 28 days before the last 14, `after` since.
function lunchLines(dishId: number, before: number, after: number): SaleLine[] {
  const out: SaleLine[] = [];
  for (let d = 1; d <= 42; d++) {
    const at = new Date(Date.parse(NOW) - d * DAY);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(at);
    if (weekday === "Sat" || weekday === "Sun") continue;
    const noon = new Date(`${at.toISOString().slice(0, 10)}T19:30:00.000Z`).toISOString(); // 12:30 Pacific
    out.push({ menu_item_id: dishId, ordered_at: noon, qty: d <= 14 ? after : before, unit_price: 16 });
    out.push({ menu_item_id: 99, ordered_at: new Date(Date.parse(noon) + 6 * 3600_000).toISOString(), qty: 1, unit_price: 5 }); // an evening order, so each day is open
  }
  return out;
}

describe("cost squeeze (purchasing + menu)", () => {
  it("fires for a current supplier's rise on a dish ingredient, with the shared impact formula", () => {
    const [d] = costSqueeze(loaded({ digest: ok(digest({ price_changes: [rise()] })) }));
    const oldUnit = (8 * 100) / 120;
    expect(d.status).toBe("verified");
    expect(d.areas).toEqual(["purchasing", "menu", "inventory"]);
    expect(d.impact?.amount_usd).toBe(priceRiseImpact(8, oldUnit, 42, "lb").impact_usd_week);
    expect(d.evidence.find((e) => e.label === "Pho Tai")?.value).toMatch(/^\$0\.67 more a plate/); // (8 - 6.67) x 0.5 lb
    expect(d.next.tools).toContain("investigate_ingredient_cost");
  });

  it("stays quiet without every part of the link", () => {
    const run = (c: PriceChangeRow) => costSqueeze(loaded({ digest: ok(digest({ price_changes: [c] })) }));
    expect(run(rise({ is_current_supplier: false }))).toEqual([]);
    expect(run(rise({ change_pct: 3 }))).toEqual([]);
    expect(run(rise({ dishes: [] }))).toEqual([]); // no dish uses it: not cross-department
    expect(costSqueeze(loaded({ digest: ok(digest({ price_changes: [rise()] })), inventory: ok({ lines: [stock({ daily_use: 0.1 })], wasteWeek: 0 }) }))).toEqual([]); // under $10 a week
    expect(costSqueeze(loaded({ digest: down() }))).toEqual([]);
  });

  it("keeps the evidence but no figure when weekly use is unknown", () => {
    const [d] = costSqueeze(loaded({ digest: ok(digest({ price_changes: [rise()] })), inventory: down() }));
    expect(d.impact).toBeNull();
    expect(d.areas).toEqual(["purchasing", "menu"]);
  });
});

describe("promotion with stock (sales + menu + inventory + marketing)", () => {
  const base = (over: Partial<Loaded> = {}) =>
    loaded({
      sales: ok({ lines: lunchLines(2, 10, 4), dishes: [{ id: 2, name: "Bun Bo Hue" }, { id: 99, name: "Iced tea" }], recipes: [{ menu_item_id: 2, ingredient_id: 100, qty: 0.25 }] }),
      inventory: ok({ lines: [stock({ estimated: 200 })], wasteWeek: 0 }),
      ...over,
    });

  it("is a hypothesis, with the lost revenue labeled as already lost", () => {
    const [d] = promoWithStock(base());
    expect(d.status).toBe("hypothesis");
    expect(d.title).toMatch(/Weekday lunch is down \d+%, and Bun Bo Hue/);
    expect(d.impact?.assumptions.join(" ")).toMatch(/not what a promotion would win back/);
    expect(d.next.tools).toEqual(["campaign_options", "draft_campaign", "start_promotion"]);
  });

  it("needs margin, stock for a promotion week, and no recent promotion", () => {
    expect(promoWithStock(base({ digest: ok(digest({ menu: [menuRow("Bun Bo Hue", { unit_margin: 6 })] })) }))).toEqual([]);
    expect(promoWithStock(base({ inventory: ok({ lines: [stock({ estimated: 2 })], wasteWeek: 0 }) }))).toEqual([]);
    expect(promoWithStock(base({ posts: ok([{ dish_name: "Bun Bo Hue", status: "posted", created_at: NOW, posted_at: new Date(Date.parse(NOW) - 3 * DAY).toISOString() }]) }))).toEqual([]);
    expect(promoWithStock(base({ posts: ok([{ dish_name: "Bun Bo Hue", status: "draft", created_at: new Date(Date.parse(NOW) - 2 * DAY).toISOString(), posted_at: null }]) }))).toEqual([]); // a fresh draft counts as posted
  });

  it("finds nothing when sales are flat", () => {
    expect(promoWithStock(base({ sales: ok({ lines: lunchLines(2, 8, 8), dishes: [{ id: 2, name: "Bun Bo Hue" }], recipes: [] }) }))).toEqual([]);
  });
});

describe("waste and prep", () => {
  const w = (cost: number, reason = "spoiled") => ({ ingredient_id: 7, name: "Bean sprouts", unit: "lb", qty: 2, cost, reason, created_at: NOW });
  it("fires on repeated waste worth $10 a week, verified when the reasons point at prep", () => {
    const [d] = wastePrep(loaded({ waste: ok([w(15), w(15, "overcooked")]) }));
    expect(d.status).toBe("verified");
    expect(d.impact).toMatchObject({ amount_usd: 15, per: "week" });
  });
  it("is a hypothesis when the log doesn't say why, and quiet for one-offs or small amounts", () => {
    expect(wastePrep(loaded({ waste: ok([w(15, "other"), w(15, "other")]) }))[0].status).toBe("hypothesis");
    expect(wastePrep(loaded({ waste: ok([w(40)]) }))).toEqual([]);
    expect(wastePrep(loaded({ waste: ok([w(5), w(5)]) }))).toEqual([]);
  });
});

describe("cash pressure (finance + purchasing)", () => {
  const order = (total: number) => ({ id: 1, status: "draft", supplier: "Delta Fresh", total, created_by: "agent", reason: null });
  it("fires when approving the waiting orders would go under the reserve", () => {
    const [d] = cashPressure(loaded({ orders: ok([order(400), order(300)]) }));
    expect(d.status).toBe("verified");
    expect(d.impact).toBeNull(); // a risk, not a dollar figure
    expect(d.evidence.find((e) => e.label === "Lowest day if approved")?.value).toBe("$800.00");
  });
  it("is quiet with room to spare, without a bank, or without orders data", () => {
    expect(cashPressure(loaded({ orders: ok([order(200)]) }))).toEqual([]);
    expect(cashPressure(loaded({ money: ok(money({ connected: false })), orders: ok([order(900)]) }))).toEqual([]);
    expect(cashPressure(loaded({ orders: down() }))).toEqual([]);
  });
  it("fires on a forecast dip under the reserve even with no orders waiting", () => {
    expect(cashPressure(loaded({ money: ok(money({ first_below: "2026-10-27", lowest: { date: "2026-10-27", balance: 600 } })) }))[0].severity).toBe("high");
  });
});

describe("billing error before payment", () => {
  it("fires for an unpaid bill with an error and no dispute sent", () => {
    const [d] = billingBeforePayment(loaded({ money: ok(money({ bills: { overdue: [], due_soon: [bill({ disputed: 160 })], later: [] } })) }));
    expect(d.impact).toEqual({ amount_usd: 160, per: "once", basis: expect.any(String), assumptions: [] });
    expect(d.next.href).toBe("/invoices/12");
  });
  it("is quiet once the dispute is sent", () => {
    expect(billingBeforePayment(loaded({ money: ok(money({ bills: { overdue: [], due_soon: [bill({ disputed: 160, dispute_status: "sent" })], later: [] } })) }))).toEqual([]);
  });
});

describe("discover", () => {
  it("ties a discovery to the loop's open case about the same thing, instead of starting another", () => {
    const [d] = discover(loaded({ digest: ok(digest({ price_changes: [rise()] })), cases: ok([kase()]) }));
    expect(d.case).toEqual({ id: 4, status: "proposed" });
    expect(discover(loaded({ digest: ok(digest({ price_changes: [rise()] })), cases: ok([kase({ status: "closed" })]) }))[0].case).toBeUndefined();
  });

  it("deduplicates by key and ranks high severity first", () => {
    const l = loaded({
      digest: ok(digest({ price_changes: [rise(), rise()] })),
      money: ok(money({ bills: { overdue: [], due_soon: [bill({ disputed: 160 })], later: [] } })),
    });
    const keys = discover(l).map((d) => d.key);
    expect(keys.filter((k) => k === "cost-squeeze:brisket")).toHaveLength(1);
    expect(keys[0]).toBe("billing-before-payment:12");
  });

  it("finds nothing in an empty restaurant, rather than making something up", () => {
    expect(discover(loaded({ digest: down(), sales: down(), waste: ok([]), money: down() }))).toEqual([]);
  });
});

describe("areas and activity", () => {
  it("reports a source that didn't load, with why, and no facts", () => {
    const areas = areaSnapshots(loaded({ money: down("bank timeout") }), 0);
    const finance = areas.find((a) => a.id === "finance")!;
    expect(finance).toMatchObject({ available: false, error: "bank timeout", facts: [] });
    expect(areas).toHaveLength(7);
  });

  it("flags an old count and an old digest as stale", () => {
    const areas = areaSnapshots(loaded({ inventory: ok({ lines: [stock({ last_counted: "2026-10-10" })], wasteWeek: 0 }), digest: ok(digest({ period: { ...digest().period, end: "2026-10-01" } })) }), 0);
    expect(areas.find((a) => a.id === "inventory")!.stale).toBe(true);
    expect(areas.find((a) => a.id === "sales")!.stale).toBe(true);
  });

  it("shows a proposed case with its action on a card as awaiting approval, and counts each stage once", () => {
    const { items, stages } = activity(loaded({
      cases: ok([kase(), kase({ id: 5, status: "closed", proposal: null, result: { value: 9, baseline: 7, difference: 2, sample: { days: 14, orders: 300 }, cost: 0, verdict: "above usual" } })]),
      actions: ok([
        { id: 31, case_id: 4, tool: "place_call", title: "Call Bay Area Meat", status: "proposed", source: "loop", created_at: NOW, done_at: null },
        { id: 40, case_id: null, tool: "set_menu_price", title: "Pho Tai to $17", status: "done", source: "agent", created_at: NOW, done_at: NOW },
      ]),
    }));
    expect(items.find((i) => i.key === "case:4")!.stage).toBe("Awaiting approval");
    expect(items.find((i) => i.key === "case:5")!.detail).toMatch(/^above usual/);
    expect(items.some((i) => i.key === "action:31")).toBe(false); // part of case 4, not listed twice
    expect(stages).toMatchObject({ "Awaiting approval": 1, Completed: 2 });
  });
});

describe("the agent's context", () => {
  const picture = buildPicture(loaded({
    digest: ok(digest({ price_changes: [rise()] })),
    money: ok(money({ bills: { overdue: [], due_soon: [bill({ disputed: 160 })], later: [] } })),
    posts: down("marketing_posts missing"),
    actions: ok([{ id: 31, case_id: null, tool: "place_call", title: "Call Bay Area Meat", status: "proposed", source: "agent", created_at: NOW, done_at: null }]),
  }));

  it("carries the same discoveries the page shows, labeled, with where to look deeper", () => {
    const block = contextBlock(picture);
    for (const d of picture.discoveries) expect(block).toContain(`[${d.key}]`);
    expect(block).toMatch(/VERIFIED \(purchasing \+ menu \+ inventory\)/);
    expect(block).toContain("get_operating_picture");
    expect(block).toContain("get_case_history");
    expect(block).toMatch(/Not available right now.*Marketing \(marketing_posts missing\)/);
    expect(picture.pending).toEqual([{ id: 31, title: "Call Bay Area Meat" }]);
  });

  it("stays under its budget by dropping the least important discoveries first", () => {
    const many = { ...picture, discoveries: Array.from({ length: 40 }, (_, i) => ({ ...picture.discoveries[0], key: `cost-squeeze:item ${i}` })) };
    const block = contextBlock(many);
    expect(block.length).toBeLessThanOrEqual(CONTEXT_BUDGET);
    expect(block).toContain("[cost-squeeze:item 0]");
    expect(block).not.toContain("[cost-squeeze:item 39]");
  });

  it("goes into the system prompt on every surface", () => {
    const facts = { restaurant: null, findings: [], proposals: [], operating: contextBlock(picture) };
    for (const surface of ["chat", "voice", "panel", "loop"] as const) expect(systemPrompt(surface, facts)).toContain("Operating picture, computed by code");
  });

  it("gives every surface, the loop included, the read-only picture and history tools", () => {
    for (const surface of ["chat", "voice", "panel", "loop"] as const) {
      const tools = toolsFor(surface).filter((t) => t.name === "get_operating_picture" || t.name === "get_case_history");
      expect(tools.map((t) => t.tier)).toEqual(["read", "read"]);
    }
  });
});

describe("get_operating_picture", () => {
  it("hands the agent the page's picture: the overview, one department, and one discovery in full", async () => {
    held.picture = buildPicture(loaded({ digest: ok(digest({ price_changes: [rise()] })) }));
    const tool = toolsFor("chat").find((t) => t.name === "get_operating_picture")!;
    const ctx = createCtx({ db: {} as SupabaseClient, surface: "chat", identity: "test" });

    const overview = JSON.parse(await tool.run({}, ctx));
    expect(overview.discoveries.map((d: { key: string }) => d.key)).toEqual(held.picture.discoveries.map((d) => d.key));
    expect(overview.areas).toHaveLength(7);

    const menu = JSON.parse(await tool.run({ area: "menu" }, ctx));
    expect(menu.discoveries[0].key).toBe("cost-squeeze:brisket");

    const full = JSON.parse(await tool.run({ discovery: "cost-squeeze:brisket" }, ctx));
    expect(full.discovery.evidence).toEqual(held.picture.discoveries[0].evidence);
    expect(await tool.run({ discovery: "made-up" }, ctx)).toMatch(/^Error: no discovery "made-up"\. Current ones: cost-squeeze:brisket/);
  });
});
