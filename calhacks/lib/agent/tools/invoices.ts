// Supplier invoices: list and read them, fix a line's match, resolve a problem, re-check, and edit
// a dispute email draft (the same services as the /api/invoices, /api/invoice-lines,
// /api/invoice-flags and /api/disputes routes).
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { aiLimitFor } from "@/lib/inventory/http";
import { signalAfter } from "@/lib/live/signal";
import { latestDispute, saveDraft } from "@/lib/purchasing/disputeService";
import { confirmLine, recheckInvoice } from "@/lib/purchasing/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { resolveInvoice, resolveOne, type InvoiceRef } from "../resolve";
import { ask, capped, changed, json, round2, defineTool } from "../types";

type Db = SupabaseClient;

type InvoiceRow = InvoiceRef & { total: number | null; status: string; open_problems: number; money_at_stake: number };

async function loadInvoices(db: Db): Promise<InvoiceRow[]> {
  const res = await db
    .from("invoices")
    .select("id, invoice_number, invoice_date, total, status, suppliers(name), invoice_flags(money_impact, resolved)")
    .eq("restaurant_id", RESTAURANT_ID)
    .order("invoice_date", { ascending: false })
    .limit(300);
  if (res.error) throw new Error(`Could not load invoices: ${res.error.message}`);
  type Row = { id: number; invoice_number: string | null; invoice_date: string; total: number | null; status: string; suppliers: { name: string } | null; invoice_flags: { money_impact: number | null; resolved: boolean }[] };
  return (res.data as unknown as Row[]).map((r) => {
    const open = r.invoice_flags.filter((f) => !f.resolved);
    return {
      id: r.id, invoice_number: r.invoice_number, invoice_date: r.invoice_date, supplier: r.suppliers?.name ?? "Unknown supplier",
      total: r.total === null ? null : Number(r.total), status: r.status,
      open_problems: open.length, money_at_stake: round2(open.reduce((s, f) => s + Number(f.money_impact ?? 0), 0)),
    };
  });
}

// One invoice from what the owner said, or a question.
async function findInvoice(db: Db, query: string) {
  return resolveInvoice(await loadInvoices(db), query);
}

const invoiceName = (i: InvoiceRef) => `${i.supplier} invoice ${i.invoice_number ?? `#${i.id}`}`;

export const invoiceTools = [
  defineTool({
    name: "list_invoices",
    description: "Supplier invoices, newest first, with total, status and open problems. status: 'unpaid', 'paid', 'all', or a status name.",
    input: z.object({ status: z.string().optional() }),
    run: async ({ status }, ctx) => {
      const s = (status ?? "all").trim().toLowerCase();
      const rows = (await loadInvoices(ctx.db)).filter((r) => (s === "all" || !s ? true : s === "unpaid" ? r.status !== "paid" : r.status === s));
      return json(capped(rows));
    },
  }),
  defineTool({
    name: "get_invoice",
    description: "One invoice in full: lines (with their ids and matches), open problems (with their ids), totals and whether it's paid. invoice: a number, or e.g. 'the latest Sysco invoice'.",
    input: z.object({ invoice: z.string() }),
    run: async ({ invoice }, ctx) => {
      const found = await findInvoice(ctx.db, invoice);
      if (!found.ok) return ask(found.ask);
      const id = found.item.id;
      const [inv, lines, flags] = await Promise.all([
        ctx.db.from("invoices").select("id, invoice_number, invoice_date, due_date, total, status, paid_at, suppliers(name)").eq("id", id).eq("restaurant_id", RESTAURANT_ID).single(),
        ctx.db.from("invoice_lines").select("id, description, pack_desc, qty, unit_price, needs_review, ingredients(name, unit)").eq("invoice_id", id).order("id"),
        ctx.db.from("invoice_flags").select("id, kind, severity, message, money_impact").eq("invoice_id", id).eq("resolved", false).order("id"),
      ]);
      if (inv.error) return `Error: Could not load the invoice: ${inv.error.message}`;
      type LineRow = { id: number; description: string; pack_desc: string | null; qty: number; unit_price: number; needs_review: boolean; ingredients: { name: string; unit: string } | null };
      return json({
        invoice: inv.data,
        paid: (inv.data as { status: string }).status === "paid",
        lines: capped(((lines.data ?? []) as unknown as LineRow[]).map((l) => ({
          line_id: l.id, description: l.description, pack: l.pack_desc, qty: Number(l.qty), unit_price: Number(l.unit_price),
          matched_to: l.ingredients?.name ?? null, needs_review: l.needs_review,
        }))),
        open_problems: (flags.data ?? []).map((f) => ({ flag_id: f.id, kind: f.kind, severity: f.severity, message: f.message, money: f.money_impact })),
        page: `/invoices/${id}`,
      });
    },
  }),
  defineTool({
    name: "confirm_invoice_line",
    description: "Say what an invoice line really is (remembered for that supplier's future invoices). line_id comes from get_invoice. Give ingredient (an existing one) or new_ingredient_name (and its unit).",
    input: z.object({ line_id: z.number().int().positive(), ingredient: z.string().optional(), new_ingredient_name: z.string().optional(), new_ingredient_unit: z.string().optional() }),
    run: async ({ line_id, ingredient, new_ingredient_name, new_ingredient_unit }, ctx) => {
      const line = await ctx.db.from("invoice_lines").select("id, description, invoices!inner(restaurant_id)").eq("id", line_id).eq("invoices.restaurant_id", RESTAURANT_ID).maybeSingle();
      if (line.error || !line.data) return "Error: Unknown invoice line.";
      let ingredientId: number | undefined;
      let name = new_ingredient_name?.trim() ?? "";
      if (ingredient?.trim()) {
        const all = await ctx.db.from("ingredients").select("id, name").eq("restaurant_id", RESTAURANT_ID);
        const found = resolveOne((all.data ?? []) as { id: number; name: string }[], ingredient, (i) => i.name, "ingredient");
        if (!found.ok) return ask(found.ask);
        ingredientId = found.item.id;
        name = found.item.name;
      }
      if (!ingredientId && !name) return "Error: Send ingredient_id or new_ingredient_name.";
      const invoiceId = await confirmLine(ctx.db, line_id, { ingredient_id: ingredientId, new_ingredient_name: ingredientId ? undefined : name, new_ingredient_unit });
      signalAfter("/api/invoice-lines/[id]/confirm");
      const description = (line.data as { description: string }).description;
      return changed(ctx, { kind: "invoice_line", label: `Invoice line "${description}": now ${name}`, before: null, after: name }, { invoice_id: invoiceId });
    },
  }),
  defineTool({
    name: "resolve_invoice_flag",
    description: "Mark one problem on an invoice as dealt with. flag_id comes from get_invoice.",
    input: z.object({ flag_id: z.number().int().positive() }),
    run: async ({ flag_id }, ctx) => {
      const flag = await ctx.db.from("invoice_flags").select("id, message, resolved, invoices!inner(restaurant_id)").eq("id", flag_id).eq("invoices.restaurant_id", RESTAURANT_ID).maybeSingle();
      if (flag.error || !flag.data) return "Error: Unknown flag.";
      // The route writes this directly too: there's no service for it
      const { error } = await ctx.db.from("invoice_flags").update({ resolved: true }).eq("id", flag_id);
      if (error) return `Error: Could not update the flag: ${error.message}`;
      signalAfter("/api/invoice-flags/[id]/resolve");
      return changed(ctx, { kind: "flag_resolved", label: `Resolved: ${(flag.data as { message: string }).message}`, before: "open", after: "resolved" });
    },
  }),
  defineTool({
    name: "check_invoice",
    description: "Re-check an invoice: match lines that aren't matched yet (may use the AI) and run every check again. invoice: a number, or e.g. 'the latest Sysco invoice'.",
    input: z.object({ invoice: z.string() }),
    run: async ({ invoice }, ctx) => {
      const found = await findInvoice(ctx.db, invoice);
      if (!found.ok) return ask(found.ask);
      const limited = aiLimitFor(ctx.identity);
      if (limited) return `Error: ${limited}`;
      const flags = await recheckInvoice(ctx.db, found.item.id);
      signalAfter("/api/invoices/[id]/check");
      return changed(ctx, {
        kind: "invoice_checked",
        label: `${invoiceName(found.item)} checked: ${flags.length} problem${flags.length === 1 ? "" : "s"} found`,
        before: null,
        after: flags.length,
      });
    },
  }),
  defineTool({
    name: "save_dispute_draft",
    description: "Edit the draft dispute email for an invoice (to, subject, body); it stays a draft and isn't sent. Only fields you pass change.",
    input: z.object({ invoice: z.string(), to_email: z.string().optional(), subject: z.string().optional(), body: z.string().optional() }),
    run: async ({ invoice, to_email, subject, body }, ctx) => {
      const found = await findInvoice(ctx.db, invoice);
      if (!found.ok) return ask(found.ask);
      const draft = await latestDispute(ctx.db, found.item.id);
      if (!draft || draft.status !== "draft") return `Error: There's no draft dispute for ${invoiceName(found.item)}. Start one on the invoice page.`;
      // Same limits as POST /api/disputes/[id]
      const edits = {
        to_email: (to_email ?? draft.to_email ?? "").trim().slice(0, 200),
        subject: (subject ?? draft.subject ?? "").slice(0, 300),
        body: (body ?? draft.body ?? "").slice(0, 5000),
      };
      await saveDraft(ctx.db, draft.id, edits);
      signalAfter("/api/disputes/[id]");
      const what = [to_email !== undefined && "to", subject !== undefined && "subject", body !== undefined && "body"].filter(Boolean).join(", ") || "nothing";
      return changed(ctx, { kind: "dispute_draft", label: `Dispute draft for ${invoiceName(found.item)} saved (changed: ${what})`, before: null, after: null });
    },
  }),
];
