// Pages and undo: a link to a page (for photos, files and "show me"), and reversing a change made
// earlier in this conversation (lib/agent/undo.ts).
import { z } from "zod";
import { UndoSchema, undoChange } from "../undo";
import { changed, defineTool } from "../types";

const PAGES = {
  overview: { href: "/", label: "Overview" },
  chat: { href: "/chat", label: "Chat" },
  inventory: { href: "/inventory", label: "Inventory" },
  prep: { href: "/prep", label: "Prep" },
  invoices: { href: "/invoices", label: "Invoices" },
  suppliers: { href: "/suppliers", label: "Suppliers" },
  menu: { href: "/menu", label: "Menu and pricing" },
  accounting: { href: "/accounting", label: "Accounting" },
  analytics: { href: "/analytics", label: "Analytics" },
  trends: { href: "/trends", label: "Trends" },
  marketing: { href: "/marketing", label: "Marketing" },
} as const;

export const navigationTools = [
  defineTool({
    name: "open_page",
    tier: "read",
    area: "navigation",
    description:
      "Give the owner a link to a page, with a short reason. Use it for anything that needs a photo or file (scan an invoice: invoices; count from a shelf photo or scan a receipt: inventory) " +
      "and for 'show me'. invoice_id opens one invoice; date (YYYY-MM-DD) opens that prep day.",
    input: z.object({
      page: z.enum(Object.keys(PAGES) as [keyof typeof PAGES, ...(keyof typeof PAGES)[]]),
      reason: z.string().max(200),
      invoice_id: z.number().int().positive().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    run: async ({ page, reason, invoice_id, date }, ctx) => {
      const base = PAGES[page];
      const href = page === "invoices" && invoice_id ? `/invoices/${invoice_id}` : page === "prep" && date ? `/prep?date=${date}` : base.href;
      const label = page === "invoices" && invoice_id ? `Invoice #${invoice_id}` : base.label;
      const link = { href, label, reason: reason.trim() };
      if (!ctx.links.some((l) => l.href === href)) ctx.links.push(link);
      return JSON.stringify({ ok: true, link, note: "The owner sees this as a link under your answer." });
    },
  }),
  defineTool({
    name: "undo_change",
    tier: "record",
    area: "navigation",
    description: "Undo a change made earlier in this conversation. Pass that change's undo payload exactly as it came back. Only stock counts and waste can be undone; anything else can't, so say so.",
    input: z.object({ undo: UndoSchema }),
    run: async ({ undo }, ctx) => {
      const result = await undoChange(ctx.db, undo, [...ctx.history, ...ctx.changes], ctx.spoken ? "voice" : "manual");
      if (!result.ok) return `Error: ${result.error}`;
      return changed(ctx, result.change);
    },
  }),
];
