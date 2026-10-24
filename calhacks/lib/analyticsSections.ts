// The Analytics modules: one page each (/analytics/<id>), and one card each on the overview.
// The overview and every module page read this one list. Pure functions: every number
// comes from the digest.

import type { AiReport, Digest, SectionId } from "./analytics";
import { hourLabel } from "./compare";
import { formatWholeMoney } from "./format";
import type { Alert } from "./insights";

export const MODULES = [
  { id: "sales", title: "Sales", question: "How much are you selling, and is it going up?", aiSections: ["kpis", "daily"] },
  { id: "busy", title: "Busy times", question: "When do customers come in, and when do you need people working?", aiSections: ["by_weekday", "by_hour"] },
  { id: "channels", title: "Delivery channels", question: "What do you keep from each way people order?", aiSections: ["channels"] },
  { id: "costs", title: "Costs and profit", question: "Where does the money go?", aiSections: ["costs"] },
  { id: "menu", title: "Menu", question: "Which dishes earn their place?", aiSections: ["menu"] },
  { id: "suppliers", title: "Supplier prices", question: "Which price increases hit you, and by how much?", aiSections: ["price_changes"] },
] as const satisfies readonly { id: string; title: string; question: string; aiSections: readonly SectionId[] }[];

export type ModuleId = (typeof MODULES)[number]["id"];
export type ModuleDef = (typeof MODULES)[number];

export const MODULE_IDS = MODULES.map((m) => m.id) as ModuleId[];

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as string[]).includes(value);
}

export function getModule(id: ModuleId): ModuleDef {
  return MODULES.find((m) => m.id === id)!;
}

// Which module page shows each part of the digest (alerts and AI notes use these ids).
export const SECTION_MODULE: Record<SectionId, ModuleId> = {
  kpis: "sales",
  daily: "sales",
  by_weekday: "busy",
  by_hour: "busy",
  channels: "channels",
  costs: "costs",
  menu: "menu",
  price_changes: "suppliers",
};

// Which module page an AI action's area belongs on.
export const ACTION_AREA_MODULE: Record<AiReport["actions"][number]["area"], ModuleId> = {
  menu: "menu",
  pricing: "menu",
  suppliers: "suppliers",
  staffing: "busy",
  marketing: "sales",
  costs: "costs",
};

// The one line shown on a module's card on the overview, so the owner knows whether to open it.
export function moduleSummary(id: ModuleId, digest: Digest): string {
  const cur = digest.kpis.cur;
  if (!cur) return "No orders in this period.";

  switch (id) {
    case "sales":
      return `${formatWholeMoney(cur.revenue_per_open_day)} per open day · ${formatWholeMoney(cur.revenue)} over ${cur.open_days} open days`;
    case "busy": {
      const busiest = [...digest.by_weekday].sort((a, b) => b.avg_revenue - a.avg_revenue)[0];
      const peak = [...digest.by_hour].sort((a, b) => (b.avg_orders ?? 0) - (a.avg_orders ?? 0))[0];
      const parts = [];
      if (busiest) parts.push(`Busiest day: ${busiest.weekday} (${formatWholeMoney(busiest.avg_revenue)} on average)`);
      if (peak) parts.push(`peak hour ${hourLabel(peak.hour)}`);
      return parts.length ? parts.join(" · ") : "No open days in this period.";
    }
    case "channels": {
      const apps = digest.channels.filter((c) => c.platform_fees > 0);
      if (apps.length === 0) return "No delivery app fees this period.";
      const revenue = apps.reduce((s, c) => s + c.revenue, 0);
      const kept = apps.reduce((s, c) => s + c.net_revenue, 0);
      return `You keep ${Math.round((kept / revenue) * 100)}% of delivery sales after ${formatWholeMoney(cur.platform_fees)} in fees`;
    }
    case "costs":
      return `Estimated profit ${formatWholeMoney(cur.est_profit)}${cur.est_profit_pct !== null ? ` (${cur.est_profit_pct}% of revenue)` : ""} · food cost ${cur.food_cost_pct ?? "-"}%`;
    case "menu": {
      const top = [...digest.menu].sort((a, b) => (b.gross_profit ?? 0) - (a.gross_profit ?? 0))[0];
      const count = (c: string) => digest.menu.filter((m) => m.class === c).length;
      const classes = `${count("star")} stars, ${count("plowhorse")} plowhorses, ${count("puzzle")} puzzles, ${count("dog")} dogs`;
      return top ? `Top earner: ${top.name} · ${classes}` : classes;
    }
    case "suppliers": {
      const increases = digest.price_changes.filter((p) => (p.est_period_impact ?? 0) > 0);
      if (increases.length === 0) return "No supplier price increases cost you money this period.";
      const total = increases.reduce((s, p) => s + (p.est_period_impact ?? 0), 0);
      return `${increases.length} price increase${increases.length === 1 ? "" : "s"} adding about ${formatWholeMoney(total)} to food cost`;
    }
  }
}

export type AlertCounts = { bad: number; good: number; info: number };

// How many alerts of each kind point at each module.
export function alertCountsByModule(alerts: Alert[]): Record<ModuleId, AlertCounts> {
  const counts = Object.fromEntries(MODULE_IDS.map((id) => [id, { bad: 0, good: 0, info: 0 }])) as Record<ModuleId, AlertCounts>;
  for (const a of alerts) counts[SECTION_MODULE[a.section]][a.tone] += 1;
  return counts;
}

// The alerts that belong on one module's page.
export function alertsForModule(alerts: Alert[], id: ModuleId): Alert[] {
  return alerts.filter((a) => SECTION_MODULE[a.section] === id);
}

// The AI report's notes for one module's charts, in the module's order.
export function aiNotesForModule(report: AiReport | null, id: ModuleId): AiReport["sections"] {
  if (!report) return [];
  const wanted: readonly SectionId[] = getModule(id).aiSections;
  return wanted.flatMap((s) => report.sections.filter((n) => n.id === s));
}

// Ready-made questions for the assistant on each module page.
export const MODULE_QUESTIONS: Record<ModuleId, string[]> = {
  sales: ["Is revenue going up or down, and why?", "Which days pulled revenue down?"],
  busy: ["When should I add staff?", "Which weekday is slowest, and what could help it?"],
  channels: ["Is delivery worth the fees?", "How could I move delivery customers to takeout?"],
  costs: ["What is my biggest cost, and can I cut it?", "Why did food cost change?"],
  menu: ["Which dishes should I promote?", "Should I change any prices?"],
  suppliers: ["Should I switch any suppliers?", "Which price increase hurts the most?"],
};
