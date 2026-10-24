import { describe, expect, it } from "vitest";
import type { Digest } from "@/lib/analytics";
import { formatWholeMoney } from "@/lib/format";
import {
  ALERT_THRESHOLDS,
  KPI_DEFS,
  buildAlerts,
  buildWaterfall,
  isReportStale,
  kpiChange,
  percentChange,
  pointChange,
} from "@/lib/insights";
import digest30Json from "./fixtures/digest-30.json";
import digest60Json from "./fixtures/digest-60.json";

// Real output of analytics_digest(1, 30) and (1, 60), saved from Supabase.
const d30 = digest30Json as unknown as Digest;
const d60 = digest60Json as unknown as Digest;
const cur30 = d30.kpis.cur!;
const prev30 = d30.kpis.prev!;

const def = (key: string) => KPI_DEFS.find((d) => d.key === key)!;

describe("percentChange", () => {
  it("computes the change rounded to 1 decimal", () => {
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(2, 3)).toBe(-33.3);
  });
  it("is null when a value is missing or prev is 0", () => {
    expect(percentChange(null, 100)).toBeNull();
    expect(percentChange(100, undefined)).toBeNull();
    expect(percentChange(100, 0)).toBeNull();
  });
  it("keeps the right sign when prev is negative", () => {
    // A loss of 100 becoming a loss of 50 is an improvement.
    expect(percentChange(-50, -100)).toBe(50);
    expect(percentChange(-150, -100)).toBe(-50);
  });
});

describe("pointChange", () => {
  it("is the difference in points, 1 decimal", () => {
    expect(pointChange(22.4, 21.9)).toBe(0.5);
    expect(pointChange(20, 22.5)).toBe(-2.5);
  });
  it("is null when a value is missing", () => {
    expect(pointChange(null, 20)).toBeNull();
    expect(pointChange(20, undefined)).toBeNull();
  });
});

describe("kpiChange", () => {
  it("uses points for percent KPIs and flips tone when lower is better", () => {
    const fc = kpiChange(def("food_cost_pct"), cur30, prev30)!;
    expect(fc.unit).toBe("pts");
    expect(fc.value).toBe(pointChange(cur30.food_cost_pct, prev30.food_cost_pct));
    // Food cost went up in the fixture, which is bad.
    expect(fc.value).toBeGreaterThan(0);
    expect(fc.tone).toBe("bad");

    // A fall in a lower-is-better KPI is good.
    const lower = kpiChange(def("food_cost_pct"), { ...cur30, food_cost_pct: 20 }, { ...prev30, food_cost_pct: 22 })!;
    expect(lower.tone).toBe("good");
  });
  it("uses % for money KPIs", () => {
    const rev = kpiChange(def("revenue"), cur30, prev30)!;
    expect(rev.unit).toBe("%");
    expect(rev.value).toBe(percentChange(cur30.revenue, prev30.revenue));
    expect(rev.tone).toBe(rev.value > 0 ? "good" : "bad");
  });
  it("is null without a previous period", () => {
    expect(kpiChange(def("revenue"), d60.kpis.cur, d60.kpis.prev)).toBeNull();
  });
});

describe("buildAlerts", () => {
  const alerts = buildAlerts(d30);
  const byId = (id: string) => alerts.find((a) => a.id === id);

  it("sorts bad, then info, then good, and keeps at most the max", () => {
    const rank = { bad: 0, info: 1, good: 2 };
    const ranks = alerts.map((a) => rank[a.tone]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(alerts.length).toBeLessThanOrEqual(ALERT_THRESHOLDS.maxAlerts);
  });

  it("notes when total revenue and revenue per open day disagree", () => {
    const total = percentChange(cur30.revenue, prev30.revenue)!;
    const perDay = percentChange(cur30.revenue_per_open_day, prev30.revenue_per_open_day)!;
    // Precondition taken from the fixture: open days differ and the two move in opposite directions.
    expect(cur30.open_days).not.toBe(prev30.open_days);
    expect(total * perDay).toBeLessThan(0);

    const a = byId("revenue-open-days")!;
    expect(a.tone).toBe("info");
    expect(a.detail).toContain(`${cur30.open_days} days`);
    expect(a.detail).toContain(`${prev30.open_days} days`);
    expect(byId("revenue-per-day")).toBeUndefined();
  });

  it("flags the food cost rise and points to supplier prices", () => {
    const a = byId("food-cost")!;
    expect(a.tone).toBe("bad");
    expect(a.title).toContain(`${prev30.food_cost_pct}%`);
    expect(a.title).toContain(`${cur30.food_cost_pct}%`);
    expect(a.section).toBe("price_changes");
  });

  it("sums the supplier price increases from the fixture", () => {
    const increases = d30.price_changes.filter((p) => (p.est_period_impact ?? 0) > 0);
    const total = increases.reduce((s, p) => s + (p.est_period_impact ?? 0), 0);
    const earliest = increases.map((p) => p.since).sort()[0];
    const top = [...increases].sort((a, b) => (b.est_period_impact ?? 0) - (a.est_period_impact ?? 0))[0];

    const a = byId("supplier-prices")!;
    expect(a.tone).toBe("bad");
    expect(a.title).toContain(`${increases.length} supplier price increases`);
    expect(a.title).toContain(earliest);
    expect(a.title).toContain(`${formatWholeMoney(total)} per ${d30.period.days} days`);
    expect(a.detail).toContain(top.ingredient);
    for (const p of increases.filter((p) => p.cheapest_supplier)) {
      expect(a.detail).toContain(p.cheapest_supplier!);
    }
  });

  it("only flags channels that moved enough and are big enough", () => {
    const expected = d30.channels
      .filter(
        (c) =>
          (c.revenue_share_pct ?? 0) >= ALERT_THRESHOLDS.channelMinSharePct &&
          Math.abs(c.net_revenue_change_pct ?? 0) >= ALERT_THRESHOLDS.channelNetPct,
      )
      .map((c) => `channel-${c.channel}`);
    expect(alerts.filter((a) => a.section === "channels").map((a) => a.id)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it("flags at most 2 dishes with big moves and enough sales", () => {
    const expected = d30.menu
      .filter(
        (m) =>
          Math.abs(m.units_change_pct ?? 0) >= ALERT_THRESHOLDS.dishUnitsPct &&
          Math.max(m.units, m.prev_units) >= ALERT_THRESHOLDS.dishMinUnits,
      )
      .sort((a, b) => Math.abs(b.units_change_pct ?? 0) - Math.abs(a.units_change_pct ?? 0))
      .slice(0, ALERT_THRESHOLDS.maxDishAlerts)
      .map((m) => `dish-${m.name}`);
    expect(alerts.filter((a) => a.section === "menu").map((a) => a.id)).toEqual(expected);
  });

  it("skips comparison alerts when there is no previous period", () => {
    const alerts60 = buildAlerts(d60);
    expect(alerts60.some((a) => ["revenue-open-days", "revenue-per-day", "food-cost"].includes(a.id))).toBe(false);
  });
});

describe("isReportStale", () => {
  it("is stale when nothing is saved", () => {
    expect(isReportStale(null, d30)).toBe(true);
    expect(isReportStale(undefined, d30)).toBe(true);
  });
  it("is fresh for the same digest, even without the daily list", () => {
    const saved: Partial<Digest> = { ...d30 };
    delete saved.daily;
    expect(isReportStale(saved, d30)).toBe(false);
  });
  it("is stale when the version differs", () => {
    expect(isReportStale({ ...d30, version: 1 }, d30)).toBe(true);
  });
  it("is stale when the period end differs", () => {
    expect(isReportStale({ ...d30, period: { ...d30.period, end: "2000-01-01" } }, d30)).toBe(true);
  });
  it("is stale when kpis.cur differs", () => {
    expect(isReportStale({ ...d30, kpis: { ...d30.kpis, cur: { ...cur30, revenue: cur30.revenue + 1 } } }, d30)).toBe(true);
    expect(isReportStale({ ...d30, kpis: {} }, d30)).toBe(true);
  });
});

describe("buildWaterfall", () => {
  for (const [name, d] of [["30 days", d30], ["60 days", d60]] as const) {
    it(`starts at revenue and ends at estimated profit (${name})`, () => {
      const steps = buildWaterfall(d);
      const cur = d.kpis.cur!;
      expect(steps[0]).toMatchObject({ label: "Revenue", amount: cur.revenue, kind: "total" });
      const last = steps[steps.length - 1];
      expect(last.label).toBe("Estimated profit");
      expect(last.kind).toBe("result");
      expect(Math.abs(last.amount - cur.est_profit)).toBeLessThan(0.01);
    });

    it(`sorts costs biggest first and floats each one (${name})`, () => {
      const steps = buildWaterfall(d);
      const costs = steps.filter((s) => s.kind === "cost");
      const sizes = costs.map((s) => s.value);
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
      expect(costs.every((s) => s.amount < 0 && s.value > 0)).toBe(true);
    });
  }

  it("handles a running total that goes below zero", () => {
    const loss: Digest = {
      ...d30,
      kpis: { cur: { ...cur30, revenue: 1000, est_profit: -500 } },
      costs: { food: 900, platform_fees: 0, fixed: { rent: 600 } },
    };
    const steps = buildWaterfall(loss);
    // Rent takes the running total from 100 down to -500.
    const rent = steps.find((s) => s.label === "Rent")!;
    expect(rent).toMatchObject({ amount: -600, base: -500, value: 600 });
    expect(steps.find((s) => s.label === "Delivery app fees")).toBeUndefined(); // zero is skipped
    expect(steps[steps.length - 1]).toMatchObject({ amount: -500, base: -500, value: 500 });
  });

  it("is empty when there are no orders", () => {
    expect(buildWaterfall({ ...d30, kpis: {} })).toEqual([]);
  });
});
