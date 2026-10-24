import { describe, expect, it } from "vitest";
import {
  BREAKDOWN_IDS,
  METRIC_IDS,
  chartLayout,
  compareSummary,
  compareTitle,
  formatMetricValue,
  invalidPairReason,
  isValidPair,
  parseCompareQuery,
  rowLabel,
  type CompareResult,
} from "@/lib/compare";
import type { Digest } from "@/lib/analytics";
import digest30Json from "./fixtures/digest-30.json";
import foodCostByCategoryJson from "./fixtures/compare-food_cost_pct-category.json";
import netByChannelJson from "./fixtures/compare-net_revenue-channel.json";
import revenueByDayJson from "./fixtures/compare-revenue-day.json";
import revenueByWeekdayJson from "./fixtures/compare-revenue-weekday.json";

// Real output of analytics_compare(1, ..., 30) and analytics_digest(1, 30), saved the same day.
const d30 = digest30Json as unknown as Digest;
const byWeekday = revenueByWeekdayJson as unknown as CompareResult;
const byChannel = netByChannelJson as unknown as CompareResult;
const byDay = revenueByDayJson as unknown as CompareResult;
const foodByCategory = foodCostByCategoryJson as unknown as CompareResult;

const period = { days: 30, start: "2026-09-23", end: "2026-10-22", previous_start: "2026-08-24", previous_end: "2026-09-22" };

function result(partial: Partial<CompareResult>): CompareResult {
  return { metric: "revenue", breakdown: "weekday", aggregation: "per_open_day", period, has_previous: true, rows: [], ...partial };
}

describe("pair rules", () => {
  it("allows 36 of the 42 pairs", () => {
    const valid = METRIC_IDS.flatMap((m) => BREAKDOWN_IDS.filter((b) => isValidPair(m, b)));
    expect(METRIC_IDS.length * BREAKDOWN_IDS.length).toBe(42);
    expect(valid.length).toBe(36);
  });
  it("blocks per-order metrics by dish and category, with a plain reason", () => {
    for (const m of ["orders", "avg_ticket", "net_revenue"] as const) {
      for (const b of ["dish", "category"] as const) {
        expect(isValidPair(m, b)).toBe(false);
        expect(invalidPairReason(m, b)).toMatch(/per order/);
      }
    }
    expect(isValidPair("revenue", "dish")).toBe(true);
    expect(invalidPairReason("units_sold", "category")).toBeNull();
  });
});

describe("parseCompareQuery", () => {
  it("reads valid params, taking the first of repeated ones", () => {
    expect(parseCompareQuery({ metric: ["units_sold", "orders"], breakdown: "dish", days: "7" })).toEqual({
      metric: "units_sold",
      breakdown: "dish",
      days: 7,
    });
    expect(parseCompareQuery(new URLSearchParams("metric=orders&breakdown=hour&days=60"))).toEqual({
      metric: "orders",
      breakdown: "hour",
      days: 60,
    });
  });
  it("falls back to revenue / weekday / 30", () => {
    expect(parseCompareQuery({})).toEqual({ metric: "revenue", breakdown: "weekday", days: 30 });
    expect(parseCompareQuery({ metric: "nonsense", breakdown: "planet", days: "14" })).toEqual({
      metric: "revenue",
      breakdown: "weekday",
      days: 30,
    });
  });
  it("keeps the metric but drops a blocked breakdown", () => {
    expect(parseCompareQuery({ metric: "orders", breakdown: "dish" })).toEqual({ metric: "orders", breakdown: "weekday", days: 30 });
  });
});

describe("labels and formatting", () => {
  it("names rows by breakdown", () => {
    // Oct 17, 2026 is a Saturday.
    expect(rowLabel("day", { key: "2026-10-17", label: "2026-10-17", value: 1, prev_value: null })).toBe("Sat Oct 17");
    expect(rowLabel("hour", { key: 12, label: "12", value: 1, prev_value: null })).toBe("12pm");
    expect(rowLabel("hour", { key: 0, label: "0", value: 1, prev_value: null })).toBe("12am");
    expect(rowLabel("hour", { key: 17, label: "17", value: 1, prev_value: null })).toBe("5pm");
    expect(rowLabel("channel", { key: "ubereats", label: "ubereats", value: 1, prev_value: null })).toBe("Uber Eats");
    expect(rowLabel("weekday", { key: 1, label: "Monday", value: 1, prev_value: null })).toBe("Monday");
  });
  it("formats values by unit", () => {
    expect(formatMetricValue("revenue", null)).toBe("-");
    expect(formatMetricValue("food_cost_pct", 22.44)).toBe("22.4%");
    expect(formatMetricValue("orders", 2504)).toBe("2,504");
    expect(formatMetricValue("orders", 12.25)).toBe("12.3");
    expect(formatMetricValue("avg_ticket", 25.69)).toBe("$25.69");
    expect(formatMetricValue("revenue", 2473.77)).toBe("$2,474");
  });
  it("builds titles", () => {
    expect(compareTitle(result({}))).toBe("Revenue by day of the week, average per open day (last 30 days)");
    expect(compareTitle(result({ metric: "food_cost_pct", breakdown: "category", aggregation: "ratio" }))).toBe(
      "Food cost % by menu category (last 30 days)",
    );
    expect(compareTitle(result({ metric: "net_revenue", breakdown: "channel", aggregation: "total" }))).toBe(
      "Kept after delivery fees by channel (last 30 days)",
    );
  });
  it("picks a layout", () => {
    expect(chartLayout("channel")).toBe("ranked");
    expect(chartLayout("dish")).toBe("ranked");
    expect(chartLayout("category")).toBe("ranked");
    expect(chartLayout("day")).toBe("columns");
    expect(chartLayout("weekday")).toBe("columns");
    expect(chartLayout("hour")).toBe("columns");
  });
});

describe("compareSummary", () => {
  it("names the highest and lowest bucket", () => {
    const text = compareSummary(
      result({
        rows: [
          { key: 1, label: "Monday", value: 2000, prev_value: null },
          { key: 6, label: "Saturday", value: 3100.5, prev_value: null },
          { key: 3, label: "Wednesday", value: 2100, prev_value: null },
        ],
      }),
    );
    expect(text).toContain("highest is Saturday at $3,101");
    expect(text).toContain("lowest is Monday at $2,000");
  });
  it("counts closed days for day", () => {
    const text = compareSummary(
      result({
        breakdown: "day",
        aggregation: "total",
        rows: [
          { key: "2026-10-20", label: "2026-10-20", value: 2500, prev_value: null },
          { key: "2026-10-21", label: "2026-10-21", value: null, prev_value: null },
          { key: "2026-10-22", label: "2026-10-22", value: 2400, prev_value: null },
        ],
      }),
    );
    expect(text).toContain("1 closed day had no orders.");
  });
  it("handles an empty result", () => {
    expect(compareSummary(result({ rows: [] }))).toContain("no data for this period");
  });
});

describe("compare fixtures agree with the digest", () => {
  it("weekday averages match by_weekday", () => {
    expect(byWeekday.aggregation).toBe("per_open_day");
    for (const w of d30.by_weekday) {
      const row = byWeekday.rows.find((r) => r.label === w.weekday);
      expect(row?.value).toBe(w.avg_revenue);
    }
    // Sorted by ISO weekday, Monday first.
    const keys = byWeekday.rows.map((r) => Number(r.key));
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });

  it("channel net revenue matches the digest's channels", () => {
    expect(byChannel.rows.length).toBe(d30.channels.length);
    for (const c of d30.channels) {
      expect(byChannel.rows.find((r) => r.key === c.channel)?.value).toBe(c.net_revenue);
    }
    // Ranked: highest first.
    const values = byChannel.rows.map((r) => r.value ?? 0);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("daily revenue adds up to the period's revenue", () => {
    expect(byDay.rows.length).toBe(d30.period.days);
    const total = byDay.rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
    expect(Math.abs(total - d30.kpis.cur!.revenue)).toBeLessThan(0.05);
    expect(byDay.rows.every((r) => r.prev_value === null)).toBe(true);
    // Closed days are null, matching the digest's closed days.
    const closed = byDay.rows.filter((r) => r.value === null).length;
    expect(closed).toBe(d30.daily.filter((d) => !d.open).length);
  });

  it("food cost by category is a ratio of totals", () => {
    expect(foodByCategory.aggregation).toBe("ratio");
    expect(foodByCategory.rows.every((r) => r.value === null || (r.value > 0 && r.value < 100))).toBe(true);
    expect(compareSummary(foodByCategory)).toMatch(/highest is .+, lowest is .+/);
  });

  it("summarizes the real daily result with its closed days", () => {
    const closed = byDay.rows.filter((r) => r.value === null).length;
    expect(compareSummary(byDay)).toContain(`${closed} closed day`);
  });
});
