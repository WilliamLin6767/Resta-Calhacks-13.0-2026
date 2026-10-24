// Invoice disputes on top of Supabase (server only).
//   startDispute  - Claude drafts the email for an invoice's open billing errors
//   saveDraft     - the owner's edits to the email and address
//   markSent      - the owner sent it from their own email; the invoice becomes "disputed"
//   closeDispute  - the supplier sent a credit, or said no; the billing errors are closed
import type { SupabaseClient } from "@supabase/supabase-js";
import { RESTAURANT_ID } from "@/lib/supabase";
import { draftDisputeEmail } from "./disputeAi";
import { disputeItems, looksLikeEmail, type FlagRow } from "./disputes";

type Db = SupabaseClient;

export type Dispute = {
  id: number; invoice_id: number; status: "draft" | "sent" | "credited" | "refused";
  amount_claimed: number; amount_credited: number | null; to_email: string | null; subject: string | null; body: string | null;
  created_at: string; sent_at: string | null; closed_at: string | null;
};

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

async function loadDispute(db: Db, id: number) {
  return must(await db.from("invoice_disputes").select("*").eq("id", id).eq("restaurant_id", RESTAURANT_ID).single(), "find that dispute") as Dispute & { flag_ids: number[] };
}

export async function latestDispute(db: Db, invoiceId: number): Promise<Dispute | null> {
  const rows = must(
    await db.from("invoice_disputes").select("*").eq("invoice_id", invoiceId).eq("restaurant_id", RESTAURANT_ID).order("created_at", { ascending: false }).limit(1),
    "load the dispute (has supabase/10_disputes.sql been run?)",
  ) as Dispute[];
  return rows[0] ?? null;
}

export async function startDispute(db: Db, invoiceId: number): Promise<Dispute> {
  const existing = await latestDispute(db, invoiceId);
  if (existing && (existing.status === "draft" || existing.status === "sent")) return existing;

  const [inv, flags, restaurant] = await Promise.all([
    db.from("invoices").select("id, invoice_number, invoice_date, supplier_id, suppliers(name, contact_name, email)").eq("id", invoiceId).eq("restaurant_id", RESTAURANT_ID).single(),
    db.from("invoice_flags").select("id, kind, message, money_impact, resolved").eq("invoice_id", invoiceId),
    db.from("restaurants").select("name, owner_names").eq("id", RESTAURANT_ID).maybeSingle(),
  ]);
  const invoice = must(inv, "load the invoice") as unknown as {
    id: number; invoice_number: string | null; invoice_date: string; supplier_id: number | null;
    suppliers: { name: string; contact_name: string | null; email: string | null } | null;
  };
  const { items, total } = disputeItems(must(flags, "load the invoice's problems") as FlagRow[]);
  if (!items.length) throw new Error("This invoice has no open billing errors to dispute.");
  const r = must(restaurant, "load the restaurant") as { name: string; owner_names: string | null } | null;

  const email = await draftDisputeEmail({
    restaurant: r?.name ?? "our restaurant", owners: r?.owner_names ?? null,
    supplier: invoice.suppliers?.name ?? "the supplier", contact_name: invoice.suppliers?.contact_name ?? null,
    invoice_number: invoice.invoice_number, invoice_date: invoice.invoice_date, items: items.map(({ message, amount }) => ({ message, amount })), total,
  });
  return must(
    await db.from("invoice_disputes").insert({
      restaurant_id: RESTAURANT_ID, invoice_id: invoice.id, supplier_id: invoice.supplier_id, status: "draft",
      amount_claimed: total, flag_ids: items.map((i) => i.flag_id), to_email: invoice.suppliers?.email ?? null,
      subject: email.subject, body: email.body,
    }).select("*").single(),
    "save the dispute",
  ) as Dispute;
}

export async function saveDraft(db: Db, id: number, edits: { to_email: string; subject: string; body: string }) {
  const d = await loadDispute(db, id);
  if (d.status !== "draft") throw new Error("This dispute was already sent.");
  must(await db.from("invoice_disputes").update(edits).eq("id", id), "save the email");
}

// `saveEmail`: also remember the address on the supplier, for next time
export async function markSent(db: Db, id: number, edits: { to_email: string; subject: string; body: string }, saveEmail: boolean) {
  const d = await loadDispute(db, id);
  if (d.status !== "draft") throw new Error("This dispute was already sent.");
  if (!looksLikeEmail(edits.to_email)) throw new Error("Add the supplier's email address first.");
  must(await db.from("invoice_disputes").update({ ...edits, status: "sent", sent_at: new Date().toISOString() }).eq("id", id), "mark it sent");
  must(await db.from("invoices").update({ status: "disputed" }).eq("id", d.invoice_id), "mark the invoice disputed");
  const inv = must(await db.from("invoices").select("supplier_id").eq("id", d.invoice_id).single(), "load the invoice") as { supplier_id: number | null };
  if (saveEmail && inv.supplier_id) {
    must(await db.from("suppliers").update({ email: edits.to_email.trim() }).eq("id", inv.supplier_id).eq("restaurant_id", RESTAURANT_ID), "save the supplier's email");
  }
}

export async function closeDispute(db: Db, id: number, outcome: "credited" | "refused", credited: number) {
  const d = await loadDispute(db, id);
  if (d.status !== "sent") throw new Error("Mark the email as sent first.");
  if (outcome === "credited" && !(credited > 0 && credited <= Number(d.amount_claimed) * 2)) throw new Error("Enter the credit the supplier gave.");
  must(
    await db.from("invoice_disputes").update({
      status: outcome, amount_credited: outcome === "credited" ? Math.round(credited * 100) / 100 : 0, closed_at: new Date().toISOString(),
    }).eq("id", id),
    "close the dispute",
  );
  if (d.flag_ids.length) must(await db.from("invoice_flags").update({ resolved: true }).in("id", d.flag_ids), "close the billing errors");
  must(await db.from("invoices").update({ status: "approved" }).eq("id", d.invoice_id), "update the invoice");
}
