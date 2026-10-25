// The operating picture: one bounded, structured summary of the whole restaurant, worked out in
// code from the existing services (lib/intelligence/load.ts). The same picture feeds the agent's
// prompt (context.ts), its get_operating_picture tool, and the Intelligence page, so what the owner
// sees is what the agent knows.
import type { Digest } from "@/lib/analytics";
import type { StockLine } from "@/lib/inventory/stock";
import type { CaseRow } from "@/lib/loop/types";

export const AREAS = ["sales", "inventory", "purchasing", "finance", "marketing", "menu", "analytics"] as const;
export type AreaId = (typeof AREAS)[number];

export const AREA_INFO: Record<AreaId, { label: string; href: string; source: string; tools: string[] }> = {
  sales: { label: "Sales", href: "/analytics", source: "Orders from the POS and delivery apps", tools: ["get_dashboard_summary", "compare_data"] },
  inventory: { label: "Inventory and prep", href: "/inventory", source: "Counts, recipes, sales and the waste log", tools: ["list_inventory", "check_ingredient", "get_prep_plan"] },
  purchasing: { label: "Purchasing", href: "/invoices", source: "Supplier prices, invoices and purchase orders", tools: ["list_purchase_orders", "list_invoices", "investigate_ingredient_cost"] },
  finance: { label: "Finance", href: "/accounting", source: "Unpaid bills, app payouts and the bank (simulated)", tools: ["get_cash_plan"] },
  marketing: { label: "Marketing", href: "/marketing", source: "Drafted and published posts", tools: ["list_marketing_posts", "campaign_options"] },
  menu: { label: "Menu", href: "/menu", source: "Dish prices, recipe costs and plates sold", tools: ["list_menu", "profit_opportunities"] },
  analytics: { label: "Analytics", href: "/analytics", source: "The analytics digest (30 days vs the 30 before)", tools: ["get_dashboard_summary", "run_analytics_report"] },
};

// ---------- What load.ts reads (trimmed to what the picture uses) ----------

// Each source either loaded or says why not, so a missing one is shown, never silently skipped.
export type Source<T> = { ok: true; data: T; at: string } | { ok: false; error: string; at: string };

export type SaleLine = { menu_item_id: number; ordered_at: string; qty: number; unit_price: number };
export type WasteRow = { ingredient_id: number; name: string; unit: string; qty: number; cost: number; reason: string | null; created_at: string };
export type OrderLite = { id: number; status: string; supplier: string; total: number; created_by: string; reason: string | null };
export type BillLite = { id: number; invoice_number: string | null; supplier: string; due_date: string | null; total: number; disputed: number; dispute_status: string | null };
export type MoneyLite = {
  connected: boolean;
  balance: number | null; // simulated bank
  reserve: number | null;
  lowest: { date: string; balance: number } | null; // the next two weeks
  first_below: string | null; // first day under the reserve
  bills: { overdue: BillLite[]; due_soon: BillLite[]; later: BillLite[] };
};
export type PostLite = { dish_name: string | null; status: string; created_at: string; posted_at: string | null };
export type ActionLite = { id: number; case_id: number | null; tool: string; title: string; status: string; source: string; created_at: string; done_at: string | null };
export type FindingLite = { key: string; title: string; tab: string; level: string; impact_usd_week: number | null; impact_once?: boolean };

export type Loaded = {
  now: string; // ISO
  digest: Source<Digest>;
  inventory: Source<{ lines: StockLine[]; wasteWeek: number }>;
  waste: Source<WasteRow[]>; // the last 14 days
  sales: Source<{ lines: SaleLine[]; dishes: { id: number; name: string }[]; recipes: { menu_item_id: number; ingredient_id: number; qty: number }[] }>;
  orders: Source<OrderLite[]>;
  money: Source<MoneyLite>;
  posts: Source<PostLite[]>;
  cases: Source<CaseRow[]>;
  actions: Source<ActionLite[]>;
  findings: Source<FindingLite[]>;
};

// ---------- The picture ----------

export type Fact = { label: string; value: string };

export type AreaSnapshot = {
  id: AreaId;
  label: string;
  href: string;
  source: string;
  available: boolean;
  error?: string;
  as_of: string | null; // when its newest data is from
  stale: boolean; // older than it should be (an old count, a digest that ended days ago)
  facts: Fact[]; // a handful of headline numbers
  tools: string[]; // where the agent gets more detail
};

// A relationship across departments, found by plain code (connect.ts). "verified": every part is a
// recorded number. "hypothesis": the numbers are real, but the link between them (that a promotion
// would help, that over-prep causes the waste) is a guess for the owner to check.
export type DiscoveryKind = "cost_squeeze" | "promo_with_stock" | "waste_prep" | "cash_pressure" | "billing_before_payment";

export type Discovery = {
  key: string; // stable: the same situation keeps the same key
  kind: DiscoveryKind;
  status: "verified" | "hypothesis";
  severity: "high" | "medium" | "low";
  title: string;
  noticed: string; // what Resta saw, in one or two sentences
  why: string; // why it matters
  areas: AreaId[];
  impact: { amount_usd: number; per: "week" | "once"; basis: string; assumptions: string[] } | null; // null: no defensible figure
  evidence: { area: AreaId; label: string; value: string; href?: string }[];
  next: { label: string; ask: string; tools: string[]; href: string; hrefLabel: string };
  case?: { id: number; status: string }; // the loop's case about the same thing, if there is one
};

export const STAGES = ["Detected", "Investigating", "Proposed", "Awaiting approval", "Executed", "Measuring", "Completed"] as const;
export type Stage = (typeof STAGES)[number];

export type ActivityItem = {
  key: string;
  kind: "case" | "action";
  id: number;
  title: string;
  detail: string | null;
  stage: Stage | "Turned down" | "Failed";
  at: string;
  href: string;
};

export type Picture = {
  generated_at: string;
  areas: AreaSnapshot[];
  discoveries: Discovery[];
  findings: FindingLite[]; // the single-department findings (lib/attention), top first
  pending: { id: number; title: string }[]; // Commit actions waiting for the owner
  activity: ActivityItem[];
  stages: Record<Stage, number>;
};
