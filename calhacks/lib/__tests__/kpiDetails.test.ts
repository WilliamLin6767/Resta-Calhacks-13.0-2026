import { describe, expect, it } from "vitest";
import type { Digest } from "@/lib/analytics";
import { formatWholeMoney } from "@/lib/format";
import { KPI_DEFS } from "@/lib/insights";
import { isModuleId } from "@/lib/analyticsSections";
import { KPI_MODULE, formatKpiValue, kpiDetail } from "@/lib/kpiDetails";
import digest30Json from "./fixtures/digest-30.json";
import digest60Json from "./fixtures/digest-60.json";

const d30 = digest30Json as unknown as Digest;
const d60 = digest60Json as unknown as Digest;
const cur = d30.kpis.cur!;
const def = (key: string) => KPI_DEFS.find((d) => d.key === key)!;

describe("kpiDetail", () => {
  it("has a formula, rows and a chart section for every KPI", () => {
    for (const d of KPI_DEFS) {
      const detail = kpiDetail(d, d30);
      expect(detail.formula.length).toBeGreaterThan(0);
      expect(detail.rows.length).toBeGreaterThan(0);
      expect(detail.rows.filter((r) => r.strong)).toHaveLength(1);
      expect(isModuleId(KPI_MODULE[d.key])).toBe(true);
    }
  });

  it("plugs the real numbers into the formula", () => {
    const perDay = kpiDetail(def("revenue_per_open_day"), d30).formula;
    expect(perDay).toContain(formatWholeMoney(cur.revenue));
    expect(perDay).toContain(`÷ ${cur.open_days} =`);
    expect(perDay).toContain(formatWholeMoney(cur.revenue_per_open_day));

    const food = kpiDetail(def("food_cost_pct"), d30).formula;
    expect(food).toContain(`${cur.food_cost_pct}%`);
    expect(food).toContain(formatWholeMoney(cur.food_cost));
  });

  it("shows this period and the previous one side by side", () => {
    const rows = kpiDetail(def("revenue"), d30).rows;
    expect(rows[0]).toEqual({ label: "Revenue", cur: formatWholeMoney(cur.revenue), prev: formatWholeMoney(d30.kpis.prev!.revenue), strong: true });
  });

  it("splits delivery fees by app, and they add up to the total", () => {
    const rows = kpiDetail(def("platform_fees"), d30).rows;
    const apps = d30.channels.filter((c) => c.platform_fees > 0);
    expect(rows).toHaveLength(apps.length + 1);
    expect(rows[0].label).toMatch(/DoorDash|Uber Eats/);
    const sum = apps.reduce((s, c) => s + c.platform_fees, 0);
    expect(Math.abs(sum - cur.platform_fees)).toBeLessThan(0.05);
  });

  it("leaves the previous column empty when there is no previous period", () => {
    const rows = kpiDetail(def("revenue"), d60).rows;
    expect(rows.every((r) => r.prev === null)).toBe(true);
  });

  it("handles a period with no orders", () => {
    expect(kpiDetail(def("revenue"), { ...d30, kpis: {} })).toEqual({ formula: "No orders in this period.", rows: [] });
  });
});

describe("formatKpiValue", () => {
  it("formats by kind", () => {
    expect(formatKpiValue(def("revenue"), cur)).toBe(formatWholeMoney(cur.revenue));
    expect(formatKpiValue(def("food_cost_pct"), cur)).toBe(`${cur.food_cost_pct}%`);
    expect(formatKpiValue(def("revenue"), undefined)).toBe("-");
  });
});
