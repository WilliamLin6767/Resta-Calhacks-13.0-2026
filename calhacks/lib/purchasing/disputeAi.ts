// Claude drafts a dispute email (server only). Code decides what is claimed and how much
// (disputes.ts); Claude only writes it. The owner edits it and sends it from their own email.
import { z } from "zod";
import { ask } from "./ai";

const EmailSchema = z.object({ subject: z.string(), body: z.string() });
export type DisputeEmail = z.infer<typeof EmailSchema>;

const SYSTEM =
  "You write short, polite, firm emails from a small restaurant to a food supplier about billing errors on one invoice. " +
  "Use only the facts given: the invoice number and date, each problem with its dollar amount, and the total credit requested. Never invent numbers, dates, names or policies. " +
  "Greet the contact by first name if given. Say which invoice, list each problem on its own line with its amount, ask for a credit memo or corrected invoice for the total, " +
  "and say the restaurant is holding that amount back until then. Keep the relationship friendly: this is a long-term supplier. " +
  "Sign off with the restaurant name (and the owners' names if given). Plain text, no markdown. Subject: short, with the invoice number.";

export async function draftDisputeEmail(facts: {
  restaurant: string; owners: string | null; supplier: string; contact_name: string | null;
  invoice_number: string | null; invoice_date: string; items: { message: string; amount: number }[]; total: number;
}): Promise<DisputeEmail> {
  return ask(SYSTEM, JSON.stringify(facts, null, 1), EmailSchema, "low");
}
