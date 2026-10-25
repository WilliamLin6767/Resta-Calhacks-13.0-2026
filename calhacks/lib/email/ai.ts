// The AI's one job for the email inbox (server only): say what an email is, and read a customer's
// order against the menu. It only proposes: invoices from unknown senders and every customer order
// wait for the owner.
import { z } from "zod";
import { ask } from "@/lib/purchasing/ai";
import type { MenuRef } from "@/lib/sales/receipt";

// Every field is required (unused ones come back as "" or 0), to keep the schema simple
const EmailSchema = z.object({
  kind: z.enum(["supplier_invoice", "customer_order", "other"]),
  reason: z.string(), // a few words: why this kind, e.g. "a monthly statement"
  customer_name: z.string(),
  pickup_date: z.string(), // YYYY-MM-DD, or ""
  pickup_time: z.string(), // HH:MM 24-hour, or ""
  lines: z.array(z.object({ asked_for: z.string(), menu_item_id: z.number().int(), qty: z.number() })),
  notes: z.string(), // anything the kitchen should know: allergies, no onions, party size
});
export type EmailRead = z.infer<typeof EmailSchema>;

const SYSTEM =
  "You sort the email inbox of a small Vietnamese restaurant. Decide what one email is: " +
  "supplier_invoice (a supplier billing the restaurant for a delivery: one invoice or bill, attached or in the text), " +
  "customer_order (a customer wants to order food, for pickup, delivery or catering), or other (anything else). " +
  "These are other, not supplier_invoice, because they repeat or come before an invoice and must not be entered as a new bill: " +
  "an account statement listing several invoices, a payment reminder or past-due notice, a receipt for a payment the restaurant made, " +
  "an order confirmation, a delivery or shipping notice, a quote or price list. Also other: questions, ads, spam, newsletters. " +
  "For a customer_order, match each dish they ask for to the menu by id, with the quantity (menu_item_id 0 if no menu item is the same dish), " +
  "and give the pickup date and time if they say one (resolve 'tomorrow', 'Friday' and so on from today's date). " +
  "Copy what they wrote; never invent dishes or quantities. For other kinds, leave the order fields empty.";

export async function readEmail(e: { from: string; subject: string; text: string; attachments: string[] }, menu: MenuRef[], today: string): Promise<EmailRead> {
  const menuText = menu.map((m) => `- id ${m.id}: ${m.name}, $${m.price.toFixed(2)}`).join("\n");
  const content =
    `Today is ${today}.\nMenu:\n${menuText}\n\nFrom: ${e.from}\nSubject: ${e.subject}\n` +
    `Attachments: ${e.attachments.length ? e.attachments.join(", ") : "none"}\n\n${e.text || "(no text)"}`;
  const read = await ask(SYSTEM, content, EmailSchema, "low");
  const ids = new Set(menu.map((m) => m.id));
  return {
    ...read,
    lines: read.lines.filter((l) => l.qty > 0).map((l) => ({ ...l, qty: Math.min(100, Math.round(l.qty)), menu_item_id: ids.has(l.menu_item_id) ? l.menu_item_id : 0 })),
  };
}
