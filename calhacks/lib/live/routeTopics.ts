// Which open screens each write route wakes up (lib/live/signal.ts bump). A topic is a page,
// or the "Needs you" bar (attention); <LiveRefresh> on each page listens to its own topic.
// Analytics, accounting, bank and market routes aren't here: those pages aren't live.
import type { Topic } from "@/convex/topics";

const INVOICES: Topic[] = ["invoices", "inventory", "suppliers", "overview", "attention"];
const STOCK: Topic[] = ["inventory", "prep", "overview", "attention"];
const MENU: Topic[] = ["menu", "overview"];

export const ROUTE_TOPICS = {
  // Supplier calls: syncCalls also bumps "calls", "attention" and each call's own section
  "/api/calls/scan": ["calls", "attention"],
  "/api/calls/request": ["calls", "attention"],
  "/api/calls/[id]/decide": ["calls", "attention"],
  "/api/calls/[id]/status": ["calls", "attention"],
  "/api/calls/[id]/recheck": ["calls", "attention"],
  "/api/calls/[id]/switch": ["calls", "attention"],
  // After a call: resolve flags, record a new price, mark a PO sent
  "/api/calls/[id]/apply": ["calls", ...INVOICES, "menu"],
  "/api/assistant": ["calls", "attention"], // propose_call

  "/api/inventory/counts": STOCK,
  "/api/inventory/waste": STOCK,
  "/api/sales/receipts": [...STOCK, "menu"], // also the menu's "Sold (30 days)"

  // A scanned invoice records new prices too, so the menu's cost to make changes
  "/api/invoices/scan": [...INVOICES, "menu"],
  "/api/invoices/[id]/check": INVOICES,
  "/api/invoices/[id]/dispute": INVOICES,
  "/api/invoices/[id]/paid": INVOICES,
  "/api/invoice-lines/[id]/confirm": [...INVOICES, "menu"], // a confirmed line can set a new price
  "/api/invoice-flags/[id]/order": INVOICES,
  "/api/invoice-flags/[id]/resolve": INVOICES,
  "/api/disputes/[id]": INVOICES,
  "/api/purchase-orders/[id]/status": INVOICES,
  "/api/orders/plan/draft": INVOICES,

  "/api/menu/delivery-prices": MENU,
  "/api/menu-items/[id]/price": MENU,
  "/api/price-changes/[id]/updated": MENU,

  "/api/attention/dismiss": ["attention"],

  // Email inbox: an emailed invoice is saved like a scanned one; a confirmed order is a sale
  "/api/inbound/email": [...INVOICES, "menu", "prep"], // catering requests show on Prep
  "/api/inbound/sample": [...INVOICES, "menu", "prep"],
  "/api/inbound/[id]/read": [...INVOICES, "menu"],
  "/api/inbound/[id]/confirm": ["invoices", "prep", "attention"], // accepted: not a sale yet
  "/api/inbound/[id]/picked-up": [...STOCK, "invoices", "menu"], // recorded as a sale (STOCK includes prep)
  "/api/inbound/[id]/register": ["invoices", "prep", "attention"],
  "/api/inbound/[id]/decline": ["invoices", "prep", "attention"],

  // Only when the reply drafted a purchase order
  "/api/chat": ["invoices", "inventory", "attention"],
  "/api/voice": ["invoices", "inventory", "attention"],
  // The one agent: its writes can touch stock, orders, invoices or alerts
  "/api/agent": ["invoices", "inventory", "attention"],
  // The loop: new cases, proposals and reports show on the Actions page, Today and the chat
  "/api/loop/tick": ["actions", "attention", "overview"],
} satisfies Record<string, Topic[]>;

export type LiveRoute = keyof typeof ROUTE_TOPICS;

// The section page a call's record lives on.
export function callSection(contextType: string): Topic {
  if (contextType === "invoice" || contextType === "purchase_order") return "invoices";
  if (contextType === "ingredient") return "inventory";
  return "suppliers";
}
