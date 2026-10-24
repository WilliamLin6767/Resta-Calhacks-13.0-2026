import { describe, expect, it } from "vitest";
import type { AiReport, Digest } from "@/lib/analytics";
import {
  ACTION_AREA_MODULE,
  MODULES,
  MODULE_IDS,
  MODULE_QUESTIONS,
  SECTION_MODULE,
  aiNotesForModule,
  alertCountsByModule,
  alertsForModule,
  isModuleId,
  moduleSummary,
} from "@/lib/analyticsSections";
import { hourLabel } from "@/lib/compare";
import { formatWholeMoney } from "@/lib/format";
import { buildAlerts } from "@/lib/insights";
import digest30Json from "./fixtures/digest-30.json";

const d30 = digest30Json as unknown as Digest;
const cur = d30.kpis.cur!;

describe("modules", () => {
  it("lists six modules with ids, titles and questions", () => {
    expect(MODULE_IDS).toEqual(["sales", "busy", "channels", "costs", "menu", "suppliers"]);
    for (const m of MODULES) {
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.question.length).toBeGreaterThan(0);
      expect(MODULE_QUESTIONS[m.id].length).toBeGreaterThan(0);
    }
  });
  it("checks module ids", () => {
    expect(isModuleId("menu")).toBe(true);
    expect(isModuleId("nonsense")).toBe(false);
  });
  it("sends every digest section and every AI area to a real module", () => {
    for (const id of Object.values(SECTION_MODULE)) expect(isModuleId(id)).toBe(true);
    for (const id of Object.values(ACTION_AREA_MODULE)) expect(isModuleId(id)).toBe(true);
    // Each AI section is owned by exactly the module SECTION_MODULE says.
    for (const m of MODULES) for (const s of m.aiSections) expect(SECTION_MODULE[s]).toBe(m.id);
  });
});

describe("moduleSummary", () => {
  it("gives every module a non-empty line", () => {
    for (const id of MODULE_IDS) expect(moduleSummary(id, d30).length).toBeGreaterThan(0);
  });
  it("uses revenue per open day for sales", () => {
    const text = moduleSummary("sales", d30);
    expect(text).toContain(formatWholeMoney(cur.revenue_per_open_day));
    expect(text).toContain(`${cur.open_days} open days`);
  });
  it("names the busiest weekday and peak hour", () => {
    const busiest = [...d30.by_weekday].sort((a, b) => b.avg_revenue - a.avg_revenue)[0];
    const peak = [...d30.by_hour].sort((a, b) => (b.avg_orders ?? 0) - (a.avg_orders ?? 0))[0];
    const text = moduleSummary("busy", d30);
    expect(text).toContain(busiest.weekday);
    expect(text).toContain(hourLabel(peak.hour));
  });
  it("shows the share of delivery sales kept, profit, top dish and supplier total", () => {
    const apps = d30.channels.filter((c) => c.platform_fees > 0);
    const kept = Math.round((apps.reduce((s, c) => s + c.net_revenue, 0) / apps.reduce((s, c) => s + c.revenue, 0)) * 100);
    expect(moduleSummary("channels", d30)).toContain(`keep ${kept}%`);
    expect(moduleSummary("costs", d30)).toContain(formatWholeMoney(cur.est_profit));
    const top = [...d30.menu].sort((a, b) => (b.gross_profit ?? 0) - (a.gross_profit ?? 0))[0];
    expect(moduleSummary("menu", d30)).toContain(top.name);
    const total = d30.price_changes.reduce((s, p) => s + Math.max(0, p.est_period_impact ?? 0), 0);
    expect(moduleSummary("suppliers", d30)).toContain(formatWholeMoney(total));
  });
  it("says so when there are no orders", () => {
    expect(moduleSummary("menu", { ...d30, kpis: {} })).toBe("No orders in this period.");
  });
});

describe("alerts by module", () => {
  const alerts = buildAlerts(d30);
  it("counts every alert once", () => {
    const counts = alertCountsByModule(alerts);
    const total = Object.values(counts).reduce((s, c) => s + c.bad + c.good + c.info, 0);
    expect(total).toBe(alerts.length);
  });
  it("filters alerts for one module", () => {
    for (const id of MODULE_IDS) {
      for (const a of alertsForModule(alerts, id)) expect(SECTION_MODULE[a.section]).toBe(id);
    }
    const all = MODULE_IDS.flatMap((id) => alertsForModule(alerts, id));
    expect(all.length).toBe(alerts.length);
  });
});

describe("aiNotesForModule", () => {
  const report: AiReport = {
    headline: "h",
    health: "watch",
    actions: [],
    sections: [
      { id: "by_hour", what_it_shows: "hours", what_it_means: "m", status: "neutral" },
      { id: "menu", what_it_shows: "menu", what_it_means: "m", status: "good" },
      { id: "by_weekday", what_it_shows: "weekdays", what_it_means: "m", status: "concern" },
    ],
  };
  it("returns the module's notes in the module's order", () => {
    expect(aiNotesForModule(report, "busy").map((n) => n.id)).toEqual(["by_weekday", "by_hour"]);
    expect(aiNotesForModule(report, "menu").map((n) => n.id)).toEqual(["menu"]);
    expect(aiNotesForModule(report, "suppliers")).toEqual([]);
    expect(aiNotesForModule(null, "menu")).toEqual([]);
  });
});
