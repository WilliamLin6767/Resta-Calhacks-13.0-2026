// Email inbox on top of Supabase (server only).
//   receiveEmail  - an email arrived: save it once, then sort it
//     supplier on file + invoice  -> read and saved like a scanned invoice (once: a second copy is skipped)
//     unknown sender + invoice    -> held until the owner says to read it
//     catering request            -> waits for the owner to accept it
//     everyday customer order     -> skipped (catering only by email: lib/email/catering.ts)
//     anything else               -> ignored
//   readHeldInvoice - the owner trusts an unknown sender's invoice
//   A customer order, step by step (statuses for kind customer_order):
//     to_confirm --accept--> confirmed (accepted, not a sale yet)
//       --picked up and paid--> done, recorded here as a sale (its dishes come off stock)
//       --rang up at the register--> done, not recorded here: the register's sale counts instead
//     declineOrder: turn it down, or cancel an accepted one
//   loadInbox     - the latest emails, for the Invoices page
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayLocal } from "@/lib/accounting/service";
import { createRateLimiter } from "@/lib/aiLimits";
import { readInvoice, readInvoiceText, type ReadInvoice } from "@/lib/purchasing/ai";
import { saveInvoiceOnce, type SavedInvoice } from "@/lib/purchasing/service";
import { loadMenu, saveReceipt } from "@/lib/sales/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { readEmail } from "./ai";
import { isCatering } from "./catering";
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
  headcount?: number; // people it's for, 0 if not said
  delivery?: boolean; // they asked for delivery
  catering?: boolean; // false: an everyday order, skipped (catering only by email)
  duplicate_of?: number; // an earlier email with the same order from the same person
};

// A customer who sends the same order twice (a resend, or a second try) shouldn't get two sales
const REPEAT_WINDOW_HOURS = 6;
const orderKey = (lines: { menu_item_id: number; qty: number }[]) =>
  [...lines].sort((a, b) => a.menu_item_id - b.menu_item_id).map((l) => `${l.menu_item_id}x${l.qty}`).join(",");

async function findRepeat(db: Db, id: number, fromEmail: string, lines: { menu_item_id: number; qty: number }[]) {
  const since = new Date(Date.now() - REPEAT_WINDOW_HOURS * 3600_000).toISOString();
  const earlier = must(
    await db.from("inbound_emails").select("id, customer_order").eq("restaurant_id", RESTAURANT_ID).eq("from_email", fromEmail)
      .eq("kind", "customer_order").in("status", ["to_confirm", "confirmed", "done"]).neq("id", id).gte("created_at", since).order("id"),
    "look for a repeated order",
  ) as { id: number; customer_order: CustomerOrder | null }[];
  const key = orderKey(lines);
  return earlier.find((e) => e.customer_order && orderKey(e.customer_order.lines) === key)?.id;
}

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

// Saved once: if the same invoice is already in the system (a resend, or the paper copy was scanned
// first), nothing is added again and the email points at the original
async function saveInvoice(db: Db, read: ReadInvoice) {
  if (!read.lines.length) throw new Error("No product lines found, so it may not be an invoice.");
  return saveInvoiceOnce(db, read, "email");
}

function invoiceNote(saved: SavedInvoice, what: string) {
  return saved.duplicate
    ? `Already in the system${saved.invoice_number ? ` (${saved.invoice_number})` : ""}, so it wasn't added twice: no second bill, stock or prices.`
    : what;
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
  const menu = await loadMenu(db);
  // Sorted first even for a supplier with an attachment: a statement or an order confirmation
  // with a PDF isn't a new invoice
  const read = await readEmail({ from: `${e.from_name} <${e.from_email}>`, subject: e.subject, text: e.text, attachments: e.attachments.map((a) => a.name) }, menu, todayLocal());

  if (read.kind === "supplier_invoice") {
    if (supplier) {
      const saved = await saveInvoice(db, file ? await readInvoice(bytesOf(file.content), file.type) : await readInvoiceText(e.text));
      return update(db, id, {
        kind: "supplier_invoice", status: "done", supplier_id: supplier.id, invoice_id: saved.id,
        note: invoiceNote(saved, file ? `Read ${file.name} from ${supplier.name}.` : `Read the invoice in the email from ${supplier.name}.`),
      });
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
      headcount: read.headcount, delivery: read.delivery,
    };
    order.catering = isCatering({ catering: read.catering, headcount: read.headcount, lines, total: order.total });
    // Catering only: an everyday order by email is skipped, with a reply pointing to phone or online ordering
    if (!order.catering) {
      return update(db, id, {
        kind: "customer_order", status: "ignored", customer_order: order,
        note: "An everyday order, not catering, so it wasn't added. Reply that they can order by phone, in person or online.",
      });
    }
    if (!lines.length) {
      return update(db, id, { kind: "customer_order", status: "needs_review", customer_order: order, note: "A catering request, but none of the dishes matched the menu. Reply to them to check." });
    }
    const repeat = await findRepeat(db, id, e.from_email, lines);
    if (repeat) order.duplicate_of = repeat;
    const forWhom = order.headcount ? ` for ${order.headcount} people` : "";
    return update(db, id, {
      kind: "customer_order", status: "to_confirm", customer_order: order,
      note: repeat
        ? `Catering request from ${order.customer_name}, the same as one they sent earlier.`
        : `Catering request from ${order.customer_name}${forWhom}${order.delivery ? ", for delivery" : ""}. Accept it to hold it.`,
    });
  }

  // A supplier's attachment that isn't an invoice (a statement, an order confirmation) is left alone too
  return update(db, id, {
    kind: "other", status: "ignored", supplier_id: supplier?.id ?? null,
    note: read.reason ? `Not a new invoice or an order: ${read.reason}` : "Not a new invoice or an order.",
  });
}

type Row = { id: number; from_email: string; kind: string; status: string; body: string | null; held_file: string | null; held_file_type: string | null; customer_order: CustomerOrder | null; order_id: number | null };

async function loadRow(db: Db, id: number): Promise<Row> {
  const row = must(
    await db.from("inbound_emails").select("id, from_email, kind, status, body, held_file, held_file_type, customer_order, order_id").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle(),
    "find that email",
  ) as Row | null;
  if (!row) throw new Error("That email isn't in the inbox.");
  return row;
}

// The owner trusts an unknown sender: read the held invoice (once), and remember the address for that
// supplier if they have none on file, so their next invoice is read straight away.
export async function readHeldInvoice(db: Db, id: number) {
  const row = await loadRow(db, id);
  if (row.kind !== "supplier_invoice" || row.status !== "needs_review") throw new Error("This email isn't waiting to be read.");
  const read = row.held_file && row.held_file_type
    ? await readInvoice(bytesOf(row.held_file), row.held_file_type)
    : await readInvoiceText(row.body ?? "");
  const saved = await saveInvoice(db, read);
  const inv = must(await db.from("invoices").select("supplier_id").eq("id", saved.id).single(), "find the invoice") as { supplier_id: number | null };
  if (inv.supplier_id) {
    await db.from("suppliers").update({ email: row.from_email }).eq("id", inv.supplier_id).is("email", null);
  }
  await update(db, id, {
    status: "done", invoice_id: saved.id, supplier_id: inv.supplier_id, held_file: null, held_file_type: null,
    note: invoiceNote(saved, "Read after you checked the sender."),
  });
  return saved;
}

const isOrder = (row: Row) => row.kind === "customer_order" && row.customer_order;
// Accepted and not finished: waiting for the customer to pick up
const isAccepted = (row: Row) => isOrder(row) && row.status === "confirmed" && !row.order_id;

// Accept: the order is held for pickup. It isn't a sale yet: it's recorded when it's paid for.
export async function acceptOrder(db: Db, id: number) {
  const row = await loadRow(db, id);
  if (!isOrder(row) || row.status !== "to_confirm") throw new Error("This order isn't waiting for you.");
  await update(db, id, { status: "confirmed", note: "Accepted. When they pick up, mark it picked up and paid, or rung up at the register." });
}

// Picked up and paid, not through the register: record the sale here, now (its dishes come off stock)
export async function orderPickedUp(db: Db, id: number) {
  const row = await loadRow(db, id);
  if (!isAccepted(row)) throw new Error("Accept the order first. If it's already done, it was recorded once.");
  const o = row.customer_order!;
  const now = new Date().toLocaleTimeString("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit" });
  const saved = await saveReceipt(db, {
    receipt_number: `EMAIL-${id}`, date: todayLocal(), time: now, channel: "takeout",
    lines: o.lines.map((l) => ({ menu_item_id: l.menu_item_id, qty: l.qty, unit_price: l.unit_price })), tax: 0, tip: 0, total: o.total,
  }, "manual");
  await update(db, id, { status: "done", order_id: saved.order_id, note: `Picked up and paid: recorded as a $${o.total.toFixed(2)} sale.` });
  return saved;
}

// Paid through the register (or its receipt will be scanned): close it without recording it again
export async function orderAtRegister(db: Db, id: number) {
  const row = await loadRow(db, id);
  if (!isAccepted(row)) throw new Error("Accept the order first. If it's already done, it was recorded once.");
  await update(db, id, { status: "done", note: "Rung up at the register, so the sale comes from there, not recorded twice." });
}

// Turn down an order or an unknown sender's invoice, or cancel an accepted order before it's paid
export async function declineOrder(db: Db, id: number) {
  const row = await loadRow(db, id);
  const waiting = row.status === "to_confirm" || row.status === "needs_review";
  if (!waiting && !isAccepted(row)) throw new Error("This email isn't waiting for you.");
  await update(db, id, { status: "declined", held_file: null, note: row.status === "confirmed" ? "Cancelled." : "Declined." });
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
