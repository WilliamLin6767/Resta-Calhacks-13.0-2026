// Email inbox on top of Supabase (server only).
//   receiveEmail  - an email arrived: save it once, then sort it
//     supplier on file + invoice  -> read and saved like a scanned invoice
//     unknown sender + invoice    -> held until the owner says to read it
//     customer order              -> waits for the owner to confirm
//     anything else               -> ignored
//   readHeldInvoice - the owner trusts an unknown sender's invoice
//   confirmOrder / declineOrder - the owner's answer to a customer's order
//   loadInbox     - the latest emails, for the Invoices page
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayLocal } from "@/lib/accounting/service";
import { createRateLimiter } from "@/lib/aiLimits";
import { readInvoice, readInvoiceText, type ReadInvoice } from "@/lib/purchasing/ai";
import { saveScannedInvoice } from "@/lib/purchasing/service";
import { loadMenu, saveReceipt } from "@/lib/sales/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { readEmail } from "./ai";
import { invoiceAttachment, isAutoReply, matchSupplier, type InboundEmail, type SupplierRef } from "./parse";

type Db = SupabaseClient;

// Every email costs an AI call or two: a backstop against a flood of mail
const dailyLimit = createRateLimiter({ limit: 150, windowMs: 24 * 60 * 60 * 1000 });

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

export type CustomerOrder = {
  customer_name: string;
  customer_email: string;
  pickup_date: string;
  pickup_time: string;
  lines: { menu_item_id: number; name: string; qty: number; unit_price: number; asked_for: string }[];
  unmatched: string[]; // what they asked for that isn't on the menu
  notes: string;
  total: number;
};

export type InboxRow = {
  id: number; from_email: string; from_name: string | null; subject: string | null; created_at: string;
  kind: "supplier_invoice" | "customer_order" | "other" | "unknown";
  status: "new" | "done" | "needs_review" | "to_confirm" | "confirmed" | "declined" | "ignored" | "error";
  invoice_id: number | null; order_id: number | null; customer_order: CustomerOrder | null; note: string | null;
  attachments: { name: string; type: string; size: number }[];
};

// base64 -> exactly its bytes (a small Buffer can sit inside a larger shared one)
function bytesOf(base64: string): ArrayBuffer {
  const b = Buffer.from(base64, "base64");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

async function update(db: Db, id: number, fields: Record<string, unknown>) {
  must(await db.from("inbound_emails").update(fields).eq("id", id), "update the email");
}

async function saveInvoice(db: Db, read: ReadInvoice) {
  if (!read.lines.length) throw new Error("No product lines found, so it may not be an invoice.");
  return saveScannedInvoice(db, read, "email");
}

// Saves the email once (a resend with the same Message-ID is skipped), then sorts it.
// Returns the inbox row id, or null for a duplicate.
export async function receiveEmail(db: Db, e: InboundEmail): Promise<number | null> {
  const inserted = await db.from("inbound_emails").insert({
    restaurant_id: RESTAURANT_ID, message_id: e.message_id.slice(0, 500), from_email: e.from_email, from_name: e.from_name || null,
    subject: e.subject || null, body: e.text || null, attachments: e.attachments.map(({ name, type, size }) => ({ name, type, size })),
  }).select("id").single();
  if (inserted.error?.code === "23505") return null; // already received
  const id = (must(inserted, "save the email (has supabase/17_email.sql been run?)") as { id: number }).id;
  try {
    await sortEmail(db, id, e);
  } catch (err) {
    await update(db, id, { status: "error", note: err instanceof Error ? err.message.slice(0, 300) : "Something went wrong." });
  }
  return id;
}

async function sortEmail(db: Db, id: number, e: InboundEmail) {
  if (isAutoReply(e)) return update(db, id, { kind: "other", status: "ignored", note: "An automatic reply or bounce." });
  if (!dailyLimit("all").ok) return update(db, id, { status: "needs_review", note: "Too many emails today to read them all. Open it to read it now." });

  const suppliers = must(await db.from("suppliers").select("id, name, email").eq("restaurant_id", RESTAURANT_ID), "load suppliers") as SupplierRef[];
  const supplier = matchSupplier(e.from_email, suppliers);
  const file = invoiceAttachment(e.attachments);

  // A supplier on file with a PDF or photo attached: read it straight away
  if (supplier && file) {
    const invoiceId = await saveInvoice(db, await readInvoice(bytesOf(file.content), file.type));
    return update(db, id, { kind: "supplier_invoice", status: "done", supplier_id: supplier.id, invoice_id: invoiceId, note: `Read ${file.name} from ${supplier.name}.` });
  }

  const menu = await loadMenu(db);
  const read = await readEmail({ from: `${e.from_name} <${e.from_email}>`, subject: e.subject, text: e.text, attachments: e.attachments.map((a) => a.name) }, menu, todayLocal());

  if (read.kind === "supplier_invoice") {
    if (supplier) {
      const invoiceId = await saveInvoice(db, await readInvoiceText(e.text));
      return update(db, id, { kind: "supplier_invoice", status: "done", supplier_id: supplier.id, invoice_id: invoiceId, note: `Read the invoice in the email from ${supplier.name}.` });
    }
    // Not a supplier on file: anyone can send an email, so the owner decides before it's read
    return update(db, id, {
      kind: "supplier_invoice", status: "needs_review", held_file: file?.content ?? null, held_file_type: file?.type ?? null,
      note: `Looks like an invoice, but ${e.from_email} isn't one of your suppliers' addresses. Read it only if you trust the sender.`,
    });
  }

  if (read.kind === "customer_order") {
    const byId = new Map(menu.map((m) => [m.id, m]));
    const lines = read.lines.filter((l) => byId.has(l.menu_item_id))
      .map((l) => ({ menu_item_id: l.menu_item_id, name: byId.get(l.menu_item_id)!.name, qty: l.qty, unit_price: byId.get(l.menu_item_id)!.price, asked_for: l.asked_for }));
    const order: CustomerOrder = {
      customer_name: read.customer_name || e.from_name || e.from_email, customer_email: e.from_email,
      pickup_date: /^\d{4}-\d{2}-\d{2}$/.test(read.pickup_date) ? read.pickup_date : "",
      pickup_time: /^\d{2}:\d{2}$/.test(read.pickup_time) ? read.pickup_time : "",
      lines, unmatched: read.lines.filter((l) => !byId.has(l.menu_item_id)).map((l) => `${l.qty} x ${l.asked_for}`),
      notes: read.notes, total: Math.round(lines.reduce((s, l) => s + l.qty * l.unit_price, 0) * 100) / 100,
    };
    if (!lines.length) {
      return update(db, id, { kind: "customer_order", status: "needs_review", customer_order: order, note: "A customer order, but none of the dishes matched the menu. Reply to them to check." });
    }
    return update(db, id, { kind: "customer_order", status: "to_confirm", customer_order: order, note: `Order from ${order.customer_name}: confirm it to add it as a sale.` });
  }

  return update(db, id, { kind: "other", status: "ignored", note: read.reason ? `Not an invoice or an order: ${read.reason}` : "Not an invoice or an order." });
}

async function loadRow(db: Db, id: number) {
  const row = must(
    await db.from("inbound_emails").select("id, from_email, kind, status, body, held_file, held_file_type, customer_order").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle(),
    "find that email",
  ) as { id: number; from_email: string; kind: string; status: string; body: string | null; held_file: string | null; held_file_type: string | null; customer_order: CustomerOrder | null } | null;
  if (!row) throw new Error("That email isn't in the inbox.");
  return row;
}

// The owner trusts an unknown sender: read the held invoice, and remember the address for that
// supplier if they have none on file, so their next invoice is read straight away.
export async function readHeldInvoice(db: Db, id: number) {
  const row = await loadRow(db, id);
  if (row.kind !== "supplier_invoice" || row.status !== "needs_review") throw new Error("This email isn't waiting to be read.");
  const read = row.held_file && row.held_file_type
    ? await readInvoice(bytesOf(row.held_file), row.held_file_type)
    : await readInvoiceText(row.body ?? "");
  const invoiceId = await saveInvoice(db, read);
  const inv = must(await db.from("invoices").select("supplier_id").eq("id", invoiceId).single(), "find the new invoice") as { supplier_id: number | null };
  if (inv.supplier_id) {
    await db.from("suppliers").update({ email: row.from_email }).eq("id", inv.supplier_id).is("email", null);
  }
  await update(db, id, { status: "done", invoice_id: invoiceId, supplier_id: inv.supplier_id, held_file: null, held_file_type: null, note: "Read after you checked the sender." });
  return invoiceId;
}

// Confirmed: the order becomes a takeout sale (its dishes come off stock), at the pickup time if given
export async function confirmOrder(db: Db, id: number) {
  const row = await loadRow(db, id);
  if (row.status !== "to_confirm" || !row.customer_order) throw new Error("This order isn't waiting for you.");
  const o = row.customer_order;
  const now = new Date().toLocaleTimeString("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit" });
  const saved = await saveReceipt(db, {
    receipt_number: `EMAIL-${id}`, date: o.pickup_date || todayLocal(), time: o.pickup_time || now, channel: "takeout",
    lines: o.lines.map((l) => ({ menu_item_id: l.menu_item_id, qty: l.qty, unit_price: l.unit_price })), tax: 0, tip: 0, total: o.total,
  }, "manual");
  await update(db, id, { status: "confirmed", order_id: saved.order_id, note: `Confirmed: ${o.lines.length} dish${o.lines.length === 1 ? "" : "es"}, $${o.total.toFixed(2)}.` });
  return saved;
}

export async function declineOrder(db: Db, id: number) {
  const row = await loadRow(db, id);
  if (row.status !== "to_confirm" && row.status !== "needs_review") throw new Error("This email isn't waiting for you.");
  await update(db, id, { status: "declined", held_file: null, note: "Declined." });
}

export async function loadInbox(db: Db, limit = 15): Promise<InboxRow[]> {
  return must(
    await db.from("inbound_emails")
      .select("id, from_email, from_name, subject, created_at, kind, status, invoice_id, order_id, customer_order, note, attachments")
      .eq("restaurant_id", RESTAURANT_ID).order("created_at", { ascending: false }).limit(limit),
    "load the email inbox (has supabase/17_email.sql been run?)",
  ) as InboxRow[];
}

// A ready-to-send reply for the customer, opened in the owner's own email app
export function confirmationEmail(o: CustomerOrder, restaurant: string) {
  const when = [o.pickup_date, o.pickup_time].filter(Boolean).join(" at ");
  const items = o.lines.map((l) => `- ${l.qty} x ${l.name}`).join("\n");
  const body =
    `Hi ${o.customer_name.split(" ")[0]},\n\nThanks for your order! Here's what we have:\n${items}\n\nTotal: $${o.total.toFixed(2)}` +
    `${when ? `\nPickup: ${when}` : ""}${o.unmatched.length ? `\n\nWe couldn't find these on our menu, so they're not included: ${o.unmatched.join(", ")}.` : ""}` +
    `\n\nSee you soon,\n${restaurant}`;
  return `mailto:${encodeURIComponent(o.customer_email)}?subject=${encodeURIComponent(`Your order with ${restaurant}`)}&body=${encodeURIComponent(body)}`;
}
