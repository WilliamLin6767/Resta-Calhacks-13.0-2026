// The autonomous loop: detectors, dedupe and cooldown, the proposal checks, measuring and the
// report wording. No database or AI: the engine's parts are passed in.
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Digest } from "@/lib/analytics";
import type { StockLine } from "@/lib/inventory/stock";
import { detectPriceRises, detectSalesDips, detectStockouts } from "@/lib/loop/detect";
import { advanceStep, detectStep, investigateStep, measureStep, pickForInvestigation, targetVerdict, type CaseStore, type EngineDeps, type TickReport } from "@/lib/loop/engine";
import { dishDaypartMetric, reportFor, verdictFor } from "@/lib/loop/measure";
import type { CaseRow, Playbook } from "@/lib/loop/types";

vi.mock("@/lib/live/signal", () => ({ signalAfter: vi.fn(), syncCallsAfter: vi.fn(), signalAction: vi.fn() }));
const { AGENT_TOOLS, createCtx, toolsFor } = await import("@/lib/agent/registry");

const digest = JSON.parse(readFileSync(new URL("./fixtures/digest-30.json", import.meta.url), "utf8")) as Digest;
const DAY = 86400_000;
const NOW = "2026-10-24T22:00:00Z"; // a Saturday afternoon, Pacific

// A weekday lunch order at 12:30 Pacific, n days before NOW
const lunchOn = (daysAgo: number) => {
  const d = new Date(Date.parse(NOW) - daysAgo * DAY);
  return { d, iso: new Date(`${d.toISOString().slice(0, 10)}T19:30:00Z`).toISOString() };
};
const isWeekday = (d: Date) => ![0, 6].includes(new Date(Date.parse(`${d.toISOString().slice(0, 10)}T19:30:00Z`)).getUTCDay());

describe("detectSalesDips", () => {
  // Weekday lunches: 40 plates of a $15 dish a day before, then fewer in the last 14 days
  const lines = (recentPlates: number) =>
    Array.from({ length: 42 }, (_, i) => i + 1)
      .map(lunchOn)
      .filter(({ d }) => isWeekday(d))
      .map(({ iso }, i, all) => ({ menu_item_id: 7, ordered_at: iso, qty: Date.parse(NOW) - Date.parse(iso) < 14 * DAY ? recentPlates : 40, unit_price: 15, order_id: i }))
      .concat([]); // keep the type

  it("fires at a 10% or larger drop worth $50 a week, with the dishes that fell", () => {
    const found = detectSalesDips(lines(34), [{ id: 7, name: "Bun Bo Hue" }], NOW); // 15% down
    const dip = found.find((f) => f.finding_key === "sales-dip:lunch:weekday")!;
    expect(dip.title).toBe("Weekday lunch revenue is down 15%");
    expect(dip.facts).toMatchObject({ prior_per_open_day: 600, recent_per_open_day: 510, drop_pct: 15 });
    expect(dip.impact_usd_week).toBe(450); // $90 a day x 5 open weekdays a week
    expect((dip.facts.dishes_down as { dish: string }[])[0].dish).toBe("Bun Bo Hue");
  });

  it("stays quiet under 10%", () => {
    expect(detectSalesDips(lines(37), [{ id: 7, name: "Bun Bo Hue" }], NOW)).toEqual([]); // 7.5% down
  });
});

describe("detectPriceRises and detectStockouts", () => {
  const line = (over: Partial<StockLine>): StockLine => ({ id: 4, name: "Brisket", unit: "lb", category: "Meat", current_qty: 20, par_level: 30, reorder_point: 10, last_counted: null, used_since: 0, estimated: 20, daily_use: 4, days_left: 5, status: "ok", ...over });

  it("finds the fixture's brisket rise with its weekly cost and market check", () => {
    const found = detectPriceRises(digest.price_changes, [line({})], () => 2);
    const brisket = found.find((f) => f.finding_key === "price-rise:4")!;
    expect(brisket.title).toBe("Bay Area Meat Co. raised brisket 13.9%");
    expect(brisket.impact_usd_week).toBe(21.47); // (6.2667 - 5.50) x 28 lb a week
    expect(brisket.facts).toMatchObject({ cheapest_supplier: "Valley Butcher Supply", market_verdict: "this_supplier" });
  });

  it("flags stock that runs out before the supplier's lead time", () => {
    const found = detectStockouts([line({ id: 3, name: "Chicken", days_left: 1 }), line({ days_left: 5 })], () => 2);
    expect(found.map((f) => f.finding_key)).toEqual(["stockout:3"]);
    expect(found[0].facts).toMatchObject({ days_short: 1, lead_days: 2 });
  });
});

// ---------- The engine ----------

function memoryCases() {
  const rows: CaseRow[] = [];
  let next = 1;
  const store: CaseStore = {
    async insert(c) {
      if (rows.some((r) => r.finding_key === c.finding_key && !["closed", "dismissed", "failed"].includes(r.status))) return null;
      const now = new Date().toISOString();
      const row = { id: next++, restaurant_id: 1, proposal: null, goal: null, baseline: null, window_start: null, window_end: null, result: null, report: null, lesson: null, error: null, is_demo: false, created_at: now, updated_at: now, closed_at: null, ...c } as CaseRow;
      rows.push(row);
      return row;
    },
    async inCooldown(key, since) {
      return rows.some((r) => r.finding_key === key && ["closed", "dismissed", "failed"].includes(r.status) && r.updated_at >= since);
    },
    async openCount(pb) {
      return rows.filter((r) => r.playbook === pb && !["closed", "dismissed", "failed"].includes(r.status)).length;
    },
    async claim(id, from, patch) {
      await Promise.resolve();
      const row = rows.find((r) => r.id === id);
      if (!row || !from.includes(row.status)) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return { ...row };
    },
    async list(statuses, limit) {
      return rows.filter((r) => statuses.includes(r.status)).slice(0, limit);
    },
    async lessons() {
      return [];
    },
    async actionsFor() {
      return actions;
    },
  };
  let actions: { id: number; tool: string; status: string }[] = [];
  return { store, rows, setActions: (a: typeof actions) => (actions = a) };
}

const playbook: Playbook = {
  id: "supplier_price_rise", title: "Supplier price rise", detect: async () => [],
  investigate: { tools: ["investigate_ingredient_cost"], question: "q" },
  actions: ["propose_call", "place_call"],
  goal: () => ({ metric: "unit_cost", label: "Cost per lb", direction: "down", unit: "$" }),
  window: { days: 14 }, baseline: "previous_invoices", limits: { cooldownDays: 14, maxOpen: 3 }, autonomy: "propose",
  measure: async () => ({ value: 5.6, baseline: 6.27, sample: { days: 14, orders: 2 }, cost: 0, unit: "$", item: "Brisket", action: "place_call" }),
};
const found = (key: string) => ({ finding_key: key, title: "Bay Area Meat raised brisket", facts: { ingredient: "Brisket" }, evidence: [], impact_usd_week: 23, basis: "b" });
const emptyReport = (): TickReport => ({ detected: [], skipped: [], proposed: [], failed: [], measuring: [], dismissed: [], closed: [], errors: [] });

function deps(store: CaseStore, over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    store, playbooks: [playbook],
    detect: async () => [found("price-rise:4")],
    investigate: async () => ({ submission: { recommendation: "Call to ask for the old price", why: "Up 13.9%", action_tools: ["propose_call", "place_call"], args: { place_call: { call: "12" } } }, drafted: ["Call request #12"] }),
    isCommit: (t) => t === "place_call",
    proposeCommit: vi.fn(async () => ({ action_id: 31 })),
    measureCase: (c, pb) => pb.measure(undefined as unknown as SupabaseClient, c),
    now: () => new Date(NOW),
    ...over,
  };
}

describe("engine: detect", () => {
  it("opens one case per finding and skips one already open", async () => {
    const { store, rows } = memoryCases();
    const report = emptyReport();
    await detectStep(deps(store), report);
    await detectStep(deps(store), report);
    expect(rows).toHaveLength(1);
    expect(report.detected).toEqual(["price-rise:4"]);
    expect(report.skipped).toEqual(["price-rise:4"]);
  });

  it("skips a finding in cooldown, and stops at the playbook's open limit", async () => {
    const { store, rows } = memoryCases();
    await detectStep(deps(store), emptyReport());
    rows[0].status = "closed";
    const report = emptyReport();
    await detectStep(deps(store), report);
    expect(report.skipped).toEqual(["price-rise:4"]); // closed just now: cooldown
    const many = emptyReport();
    await detectStep(deps(store, { detect: async () => ["a", "b", "c", "d"].map(found) }), many);
    expect(many.detected).toEqual(["a", "b", "c"]); // maxOpen 3
    expect(many.skipped).toEqual(["d"]);
  });
});

describe("engine: investigate and propose", () => {
  it("proposes only the Commit actions, linked to the case, and moves it to proposed", async () => {
    const { store, rows } = memoryCases();
    await detectStep(deps(store), emptyReport());
    const d = deps(store);
    const report = emptyReport();
    await investigateStep(d, report);
    expect(d.proposeCommit).toHaveBeenCalledTimes(1);
    expect(d.proposeCommit).toHaveBeenCalledWith("place_call", { call: "12" }, expect.objectContaining({ id: rows[0].id }));
    expect(rows[0]).toMatchObject({ status: "proposed", proposal: { action_ids: [31], drafted: ["Call request #12"] } });
    expect(report.proposed).toEqual([rows[0].id]);
  });

  it("refuses a proposal with a tool outside the playbook", async () => {
    const { store, rows } = memoryCases();
    await detectStep(deps(store), emptyReport());
    const d = deps(store, { investigate: async () => ({ submission: { recommendation: "r", why: "w", action_tools: ["set_menu_price"], args: {} }, drafted: [] }) });
    await investigateStep(d, emptyReport());
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("set_menu_price");
    expect(d.proposeCommit).not.toHaveBeenCalled();
  });

  it("submit_proposal itself refuses tools outside the playbook, and only exists on the loop", async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "submit_proposal")!;
    const ctx = createCtx({ db: {} as SupabaseClient, surface: "loop", identity: "loop", loop: { caseId: 1, playbook: "sales_dip", allowed: ["draft_campaign", "start_promotion"], submission: null } });
    expect(await tool.run({ recommendation: "Raise prices", why: "because", action_tools: ["set_menu_price"], args: {} }, ctx)).toContain("isn't allowed");
    expect(ctx.loop!.submission).toBeNull();
    await tool.run({ recommendation: "Promote Bun Bo Hue", why: "lunch is down 13%", action_tools: ["start_promotion"], args: {} }, ctx);
    expect(ctx.loop!.submission).toMatchObject({ action_tools: ["start_promotion"] });
    expect(toolsFor("chat").map((t) => t.name)).not.toContain("submit_proposal");
  });

  it("the loop surface gets no Commit or record tools", () => {
    const loop = toolsFor("loop");
    expect(loop.some((t) => t.tier === "commit" || t.tier === "record")).toBe(false);
    expect(loop.map((t) => t.name)).toContain("submit_proposal");
  });
});

describe("engine: after approval, and measuring", () => {
  async function proposedCase() {
    const m = memoryCases();
    await detectStep(deps(m.store), emptyReport());
    await investigateStep(deps(m.store), emptyReport());
    return m;
  }

  it("moves to measuring when the owner's approved action ran, and dismisses when all were turned down", async () => {
    const a = await proposedCase();
    a.setActions([{ id: 31, tool: "place_call", status: "proposed" }]);
    await advanceStep(deps(a.store), emptyReport());
    expect(a.rows[0].status).toBe("proposed"); // still waiting
    a.setActions([{ id: 31, tool: "place_call", status: "done" }]);
    await advanceStep(deps(a.store), emptyReport());
    expect(a.rows[0]).toMatchObject({ status: "measuring", window_start: new Date(NOW).toISOString(), window_end: new Date(Date.parse(NOW) + 14 * DAY).toISOString() });

    const b = await proposedCase();
    b.setActions([{ id: 31, tool: "place_call", status: "rejected" }]);
    await advanceStep(deps(b.store), emptyReport());
    expect(b.rows[0].status).toBe("dismissed");
  });

  it("closes a measured case with a fixed-wording report and a lesson", async () => {
    const a = await proposedCase();
    a.setActions([{ id: 31, tool: "place_call", status: "done" }]);
    await advanceStep(deps(a.store), emptyReport());
    const later = deps(a.store, { now: () => new Date(Date.parse(NOW) + 15 * DAY) });
    await measureStep(later, emptyReport());
    const c = a.rows[0];
    expect(c.status).toBe("closed");
    expect(c.result).toMatchObject({ value: 5.6, baseline: 6.27, difference: -0.67, verdict: "above usual" });
    expect(c.lesson).toEqual({ playbook: "supplier_price_rise", action: "place_call", item: "Brisket", verdict: "above usual", difference: -0.67 });
    expect(c.report).toContain("association, not proof");
  });
});

describe("measure", () => {
  it("verdicts in the goal's direction, within 5% is about the same", () => {
    const base = { baseline: 10, days: 14, orders: 60, needsOrders: true };
    expect(verdictFor({ ...base, value: 12, direction: "up" })).toBe("above usual");
    expect(verdictFor({ ...base, value: 10.4, direction: "up" })).toBe("about the same");
    expect(verdictFor({ ...base, value: 8, direction: "up" })).toBe("below usual");
    expect(verdictFor({ ...base, value: 8, direction: "down" })).toBe("above usual");
  });

  it("is too early to tell under 7 days or 30 orders", () => {
    expect(verdictFor({ value: 20, baseline: 10, direction: "up", days: 6, orders: 100, needsOrders: true })).toBe("too early to tell");
    expect(verdictFor({ value: 20, baseline: 10, direction: "up", days: 14, orders: 29, needsOrders: true })).toBe("too early to tell");
    expect(verdictFor({ value: 20, baseline: 10, direction: "up", days: 14, orders: 2, needsOrders: false })).toBe("above usual");
    expect(targetVerdict(0, 0, "down", 7)).toBe("above usual");
    expect(targetVerdict(2, 0, "down", 7)).toBe("below usual");
    expect(targetVerdict(0, 0, "down", 3)).toBe("too early to tell");
  });

  it("never says caused, and says association, not proof once", () => {
    const goal = { metric: "m", label: "Plates a day", direction: "up" as const, unit: "plates a day" };
    for (const verdict of ["above usual", "about the same", "below usual"] as const) {
      const text = reportFor({ title: "Weekday lunch was down", action: "drink bundle", goal, value: 12, baseline: 10, baselineMethod: "the same weekdays before", sample: { days: 14, orders: 80 }, cost: 24, verdict });
      expect(text).not.toMatch(/caused|because of/i);
      expect(text.match(/association, not proof/g)).toHaveLength(1);
    }
    expect(reportFor({ title: "t", action: "a", goal, value: null, baseline: 10, baselineMethod: "m", sample: { days: 3, orders: 5 }, cost: 0, verdict: "too early to tell" })).toContain("isn't enough data");
  });

  it("measures a dish's daypart plates against the same weekdays before", () => {
    const start = "2026-10-12T07:00:00Z"; // Monday 00:00 Pacific
    const end = "2026-10-19T07:00:00Z";
    const at = (day: string, hour = "19") => `${day}T${hour}:30:00Z`; // 12:30 Pacific, or "02": 7:30 pm the day before
    const lines = [
      { menu_item_id: 7, ordered_at: at("2026-10-13"), qty: 12, unit_price: 15 }, // window, lunch
      { menu_item_id: 7, ordered_at: at("2026-10-06"), qty: 8, unit_price: 15 }, // 1 week before, lunch
      { menu_item_id: 7, ordered_at: at("2026-09-29"), qty: 8, unit_price: 15 }, // 2 weeks before
      { menu_item_id: 3, ordered_at: at("2026-10-15", "02"), qty: 5, unit_price: 10 }, // window (Oct 14, dinner), another dish
    ];
    const m = dishDaypartMetric(lines, 7, "lunch", start, end);
    expect(m.value).toBe(6); // 12 plates over 2 open days in the window
    expect(m.baseline).toBe(8); // 16 plates over 2 open days before
    expect(m.days).toBe(2);
  });
});

describe("pickForInvestigation", () => {
  const c = (id: number, playbook: string, impact: number | null) => ({ id, playbook, facts: { impact_usd_week: impact } }) as unknown as CaseRow;

  it("takes the most valuable case of each playbook first, then the rest by dollars", () => {
    const cases = [c(2, "supplier_price_rise", 33.88), c(3, "supplier_price_rise", 6.72), c(4, "supplier_price_rise", 18.74), c(5, "sales_dip", 619.27), c(6, "sales_dip", 280.79), c(7, "stockout_risk", 120)];
    expect(pickForInvestigation(cases, 3).map((x) => x.id)).toEqual([5, 7, 2]); // one of each kind, by value
    expect(pickForInvestigation(cases, 4).map((x) => x.id)).toEqual([5, 7, 2, 6]); // then the next most valuable
  });

  it("ranks cases with no dollar figure last", () => {
    expect(pickForInvestigation([c(1, "stockout_risk", null), c(2, "stockout_risk", 40)], 1).map((x) => x.id)).toEqual([2]);
  });
});

describe("advance and submit, after the demo-run fixes", () => {
  it("only counts the proposal's own actions, and a proposal with none stays proposed", async () => {
    const m = memoryCases();
    await detectStep(deps(m.store), emptyReport());
    await investigateStep(deps(m.store), emptyReport()); // proposes action 31
    m.setActions([{ id: 2, tool: "place_call", status: "rejected" }]); // an older card on the same case
    await advanceStep(deps(m.store), emptyReport());
    expect(m.rows[0].status).toBe("proposed");

    const n = memoryCases();
    await detectStep(deps(n.store), emptyReport());
    await investigateStep(deps(n.store, { investigate: async () => ({ submission: { recommendation: "Approve the pending call", why: "w", action_tools: [], args: {} }, drafted: [] }) }), emptyReport());
    await advanceStep(deps(n.store), emptyReport());
    expect(n.rows[0].status).toBe("proposed"); // nothing to approve: not measured
  });

  it("fails the case when its Commit action couldn't be proposed, even if it drafted something", async () => {
    const m = memoryCases();
    await detectStep(deps(m.store), emptyReport());
    await investigateStep(deps(m.store, { proposeCommit: async () => ({ error: "bad arguments" }) }), emptyReport());
    expect(m.rows[0]).toMatchObject({ status: "failed" });
    expect(m.rows[0].error).toContain("bad arguments");
  });

  it("submit_proposal refuses wrong arguments so the agent can fix them", async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "submit_proposal")!;
    const checkArgs = (t: string, args: Record<string, unknown>) => (t === "start_promotion" && !args.post ? "start_promotion needs { post, offer }." : null);
    const ctx = createCtx({ db: {} as SupabaseClient, surface: "loop", identity: "loop", loop: { caseId: 1, playbook: "sales_dip", allowed: ["start_promotion"], submission: null, checkArgs } });
    expect(await tool.run({ recommendation: "Promote it", why: "lunch is down", action_tools: ["start_promotion"], args: { start_promotion: { post_id: 43 } } }, ctx)).toContain("needs { post, offer }");
    expect(ctx.loop!.submission).toBeNull();
    await tool.run({ recommendation: "Promote it", why: "lunch is down", action_tools: ["start_promotion"], args: { start_promotion: { post: "43", offer: "drink_bundle" } } }, ctx);
    expect(ctx.loop!.submission).not.toBeNull();
  });
});
