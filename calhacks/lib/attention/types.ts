// The "Needs you" bar at the top of each tab: things for the owner to approve, deny, send or check.
// Items are worked out by plain code from the same data the tab shows (build.ts); the AI only
// writes the summary above them (ai.ts).

export const TABS = ["inventory", "prep", "invoices", "menu", "accounting"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABELS: Record<Tab, { label: string; href: string }> = {
  inventory: { label: "Inventory", href: "/inventory" },
  prep: { label: "Prep", href: "/prep" },
  invoices: { label: "Invoices and buying", href: "/invoices" },
  menu: { label: "Menu and pricing", href: "/menu" },
  accounting: { label: "Accounting", href: "/accounting" },
};

// What a button on an item does
export type Action =
  | { kind: "link"; label: string; href: string } // go somewhere in the app
  | { kind: "post"; label: string; path: string; body?: Record<string, unknown>; primary?: boolean } // call the server, then refresh
  | { kind: "posts"; label: string; calls: { path: string; body?: Record<string, unknown> }[] } // several of those, in order
  | { kind: "open"; label: string; href: string } // open the owner's own app (Messages, phone, email); they press send there
  | { kind: "copy"; label: string; text: string } // copy a message to paste somewhere
  | { kind: "plan"; label: string; request: Record<string, unknown> }; // the supplier order plan (components/OrderPlan.tsx)

export type Item = {
  key: string; // stable id, e.g. "order:12"
  fingerprint: string; // changes when the item changes; a dismissal only hides this fingerprint
  tab: Tab;
  level: "act" | "watch" | "info"; // act = needs a decision now
  title: string;
  detail?: string;
  actions: Action[];
  dismissable?: boolean; // alerts can be dismissed; approvals are approved or denied instead
};

// What the tab's AI summary is written from: the to-do items plus a few key numbers
export type TabFacts = { tab: Tab; numbers: Record<string, unknown>; items: { level: string; title: string; detail?: string }[] };
