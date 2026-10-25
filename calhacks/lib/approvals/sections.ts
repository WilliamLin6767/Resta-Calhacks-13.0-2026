// Where an approval belongs on the Actions page (pure). Everything that waits for the owner's OK
// lives on that one page, grouped by department. An approval whose evidence comes from more than
// one department (a cross-department discovery, a loop case that joins sales and marketing, a
// proposal citing pages from two departments) goes under Mixed, with the reason.
import type { Action, Item, Tab } from "@/lib/attention/types";
import { AREA_INFO, type AreaId, type Discovery } from "@/lib/intelligence/types";

export const BOARD = ["inventory", "purchasing", "menu", "finance", "marketing", "mixed"] as const;
export type BoardSection = (typeof BOARD)[number];

export const BOARD_INFO: Record<BoardSection, { label: string; hint: string }> = {
  inventory: { label: "Inventory and prep", hint: "Stock, waste and the prep plan" },
  purchasing: { label: "Purchasing and suppliers", hint: "Orders, supplier calls, invoices and disputes" },
  menu: { label: "Menu and pricing", hint: "Dish prices and delivery-app prices" },
  finance: { label: "Finance", hint: "Bills, payouts, savings and the reserve" },
  marketing: { label: "Marketing", hint: "Posts and promotions" },
  mixed: { label: "Mixed", hint: "Came from more than one department" },
};

// The department each Commit tool acts in (lib/agent/executors.ts).
export const TOOL_AREA: Record<string, AreaId> = {
  approve_purchase_order: "purchasing", send_purchase_order: "purchasing", place_call: "purchasing", reject_call: "purchasing",
  apply_call_result: "purchasing", send_dispute: "purchasing", mark_invoice_paid: "finance", bank_reserve: "finance", bank_savings: "finance",
  set_menu_price: "menu", set_delivery_prices: "menu", mark_delivery_price_updated: "menu", publish_post: "marketing", start_promotion: "marketing",
};

// The departments each loop playbook draws its evidence from (lib/loop/playbooks).
export const PLAYBOOK_AREAS: Record<string, AreaId[]> = {
  supplier_price_rise: ["purchasing"],
  sales_dip: ["sales", "marketing"],
  stockout_risk: ["inventory", "purchasing"],
};

// Where a tool's approval is filed when nothing else is known (the chat links there).
export const sectionOfTool = (tool: string): BoardSection => boardOf(TOOL_AREA[tool] ?? "purchasing");

const TAB_AREA: Record<Tab, AreaId> = { inventory: "inventory", prep: "inventory", invoices: "purchasing", menu: "menu", accounting: "finance" };

// The department a page link belongs to: "/suppliers/3" -> purchasing.
export function hrefArea(href: string | undefined): AreaId | null {
  if (!href) return null;
  const path = href.split(/[?#]/)[0];
  if (/^\/(inventory|prep)(\/|$)/.test(path)) return "inventory";
  if (/^\/(invoices|suppliers)(\/|$)/.test(path)) return "purchasing";
  if (/^\/menu(\/|$)/.test(path)) return "menu";
  if (/^\/accounting(\/|$)/.test(path)) return "finance";
  if (/^\/marketing(\/|$)/.test(path)) return "marketing";
  if (/^\/(analytics|trends)(\/|$)/.test(path)) return "sales";
  return null;
}

// The discovery a proposal came from, when the chat was opened from one (its evidence links to
// /intelligence#<key>; lib/agent/tools/commit.ts adds it).
export const discoveryKeyOf = (evidence: { href?: string }[]) =>
  evidence.map((e) => e.href?.match(/^\/intelligence#(.+)$/)?.[1]).find((k): k is string => Boolean(k)) ?? null;

export type Placed = { section: BoardSection; areas: AreaId[]; reason: string | null };

const boardOf = (a: AreaId): BoardSection => (a === "sales" || a === "analytics" ? "mixed" : a);

function place(areas: Set<AreaId>, home: AreaId, from: Discovery | null): Placed {
  const list = [...areas];
  if (list.length > 1) {
    const reason = from ? `From the discovery "${from.title}"` : `Draws on ${list.map((a) => AREA_INFO[a].label.toLowerCase()).join(" and ")}`;
    return { section: "mixed", areas: list, reason };
  }
  return { section: boardOf(home), areas: list, reason: null };
}

export type ActionForBoard = { tool: string; case_id: number | null; evidence: { href?: string }[] };
export type BoardContext = {
  casePlaybook: Map<number, string>; // case id -> playbook
  caseDiscovery: Map<number, Discovery>; // case id -> the discovery tied to it (lib/intelligence)
  discoveries: Map<string, Discovery>; // by key
};

export function placeAction(a: ActionForBoard, ctx: BoardContext): Placed {
  const home = TOOL_AREA[a.tool] ?? "purchasing";
  const areas = new Set<AreaId>([home]);
  for (const e of a.evidence) {
    const area = hrefArea(e.href);
    if (area) areas.add(area);
  }
  const playbook = a.case_id !== null ? ctx.casePlaybook.get(a.case_id) : undefined;
  for (const area of PLAYBOOK_AREAS[playbook ?? ""] ?? []) areas.add(area);
  const key = discoveryKeyOf(a.evidence);
  const from = (key ? ctx.discoveries.get(key) : undefined) ?? (a.case_id !== null ? ctx.caseDiscovery.get(a.case_id) : undefined) ?? null;
  for (const area of from?.areas ?? []) areas.add(area);
  return place(areas, home, from);
}

// ---------- The "Needs you" items that are approvals ----------

// The buttons that agree to something for the owner: approving or denying a purchase order, a menu
// price, the delivery-app prices, a move to savings, or accepting or declining an emailed order.
// Recording what already happened (Mark paid, Mark as sent, Picked up) stays on its page.
export function isApprovalAction(a: Action): boolean {
  if (a.kind === "post") {
    if (/^\/api\/purchase-orders\/\d+\/status$/.test(a.path)) return ["approved", "cancelled"].includes(String(a.body?.status));
    return /^\/api\/(menu-items\/\d+\/price|menu\/delivery-prices|bank\/savings|inbound\/\d+\/(confirm|decline))$/.test(a.path);
  }
  if (a.kind === "posts") return a.calls.some((c) => /^\/api\/menu-items\/\d+\/price$/.test(c.path));
  return false;
}

export const isApprovalItem = (item: Pick<Item, "actions">) => item.actions.some(isApprovalAction);

// The purchase order an item approves, so a loop proposal for the same order isn't shown twice.
export function itemOrderId(item: Pick<Item, "actions">): number | null {
  for (const a of item.actions) {
    const m = a.kind === "post" ? a.path.match(/^\/api\/purchase-orders\/(\d+)\/status$/) : null;
    if (m) return Number(m[1]);
  }
  return null;
}

// What the approval does decides its section (an order is purchasing, whichever tab listed it);
// otherwise the tab it came from.
export function itemSection(item: Pick<Item, "tab"> & Partial<Pick<Item, "actions">>): BoardSection {
  for (const a of item.actions ?? []) {
    const paths = a.kind === "post" ? [a.path] : a.kind === "posts" ? a.calls.map((c) => c.path) : [];
    for (const path of paths) {
      if (/^\/api\/purchase-orders\//.test(path)) return "purchasing";
      if (/^\/api\/(menu-items|menu)\//.test(path)) return "menu";
      if (/^\/api\/bank\//.test(path)) return "finance";
    }
  }
  return boardOf(TAB_AREA[item.tab]);
}
