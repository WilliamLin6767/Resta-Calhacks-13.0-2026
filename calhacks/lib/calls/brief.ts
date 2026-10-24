// The instructions the calling agent (Wajo's Fo) gets for one approved call,
// built from the stored brief plus fresh data (restaurant, supplier contact,
// the number to dial). Pure: no database or network calls.
//
// Fixed rules that don't depend on the brief (AI disclosure, no card details,
// no new contract terms, confirm in writing, only call this number) are added
// here, so neither Claude nor an edited brief can leave them out.

import type { Brief, CallPurpose } from "./types";

export type CallMessageInput = {
  brief: Brief;
  purpose: CallPurpose;
  restaurantName: string;
  restaurantEmail?: string | null;
  supplier: { name: string; contact_name: string | null };
  dial: string; // E.164, from dialTarget()
};

// Who to ask for when the brief doesn't name anyone.
export function defaultAskFor(purpose: CallPurpose, contactName: string | null): string {
  if (contactName?.trim()) return contactName.trim();
  return purpose === "dispute" ? "accounts (billing)" : "orders";
}

const money = (n: number) => `$${n.toFixed(2)}`;

// The limits section, as plain rules.
export function limitLines(brief: Brief, restaurantEmail?: string | null): string[] {
  const { min_credit, max_packs, max_total, notes } = brief.limits;
  const lines: string[] = [];
  if (min_credit > 0) {
    lines.push(
      `You may accept a credit or a corrected invoice for at least ${money(min_credit)}. Don't accept less; say the owner will follow up.`
    );
  }
  if (max_packs > 0 || max_total > 0) {
    const parts = [max_packs > 0 ? `at most ${max_packs} packs` : "", max_total > 0 ? `at most ${money(max_total)} total` : ""].filter(Boolean);
    lines.push(`Order ${parts.join(", ")}. If they can't do it within that, don't order; ask what they can do and report back.`);
  }
  if (notes.trim()) lines.push(notes.trim());
  lines.push("Never give payment card or bank details. If they ask how we'll pay, say the owner will handle payment.");
  lines.push("Don't agree to new contract terms, new prices, minimums or standing orders beyond these limits.");
  lines.push(
    restaurantEmail
      ? `Ask them to confirm what was agreed by email to ${restaurantEmail}.`
      : "Ask them to confirm what was agreed in writing (email or text) to the restaurant."
  );
  lines.push("If they ask for anything outside these limits, say the owner will follow up, and don't commit.");
  return lines;
}

// The full message sent to the calling agent with ask_fo.
export function buildCallMessage(input: CallMessageInput): string {
  const { brief, purpose, restaurantName, restaurantEmail, supplier, dial } = input;
  const askFor = brief.ask_for.trim() || defaultAskFor(purpose, supplier.contact_name);
  const list = (items: string[]) => items.map((s) => `- ${s}`).join("\n");

  const sections = [
    `Please place one phone call now to ${supplier.name} at ${dial}, for the restaurant ${restaurantName}. ` +
      "The restaurant owner has already reviewed and approved this exact call in their app, so you don't need to ask for another go-ahead.",
    `Call exactly ${dial} and no other number. Don't send any email or text message, and don't buy anything except what the limits below allow.`,
    `Who you are: an AI assistant calling on behalf of ${restaurantName}. Open the call with "Hi, this is an AI assistant calling on behalf of ${restaurantName}." ` +
      "If anyone asks whether you're a person or a machine, say you're an AI assistant.",
    `Who to ask for: ${askFor}.`,
    `Goal: ${brief.goal.trim()}`,
    brief.facts.length ? `Facts:\n${list(brief.facts)}` : "",
    brief.questions.length ? `Questions to ask:\n${list(brief.questions)}` : "",
    brief.wanted_by.trim() ? `Wanted by: ${brief.wanted_by.trim()}.` : "",
    `Limits:\n${list(limitLines(brief, restaurantEmail))}`,
    "When the call is over, reply with:\n" +
      list([
        "whether you reached a person, and who",
        "the outcome: resolved, partly resolved, refused, no answer, or they'll call back",
        "any credit amount, any new price per pack and the date it starts, the delivery date, and whether an order was confirmed",
        "anything the owner needs to follow up on",
        "a short transcript of the call",
      ]),
  ];
  return sections.filter(Boolean).join("\n\n");
}
