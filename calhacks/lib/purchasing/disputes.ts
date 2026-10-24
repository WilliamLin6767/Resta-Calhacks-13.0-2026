// Invoice disputes: what to claim, and the link that opens the owner's own email app.
// Pure functions, no database calls and no AI.
import { BILLING_ERROR_KINDS } from "./checks";

export type FlagRow = { id: number; kind: string; message: string; money_impact: number | null; resolved: boolean };
export type DisputeStatus = "draft" | "sent" | "credited" | "refused";

// The open billing errors on an invoice (not price rises or savings: those aren't the supplier's mistake)
export function disputeItems(flags: FlagRow[]) {
  const items = flags
    .filter((f) => !f.resolved && BILLING_ERROR_KINDS.has(f.kind) && Number(f.money_impact ?? 0) > 0)
    .map((f) => ({ flag_id: f.id, message: f.message, amount: Math.round(Number(f.money_impact) * 100) / 100 }));
  return { items, total: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100 };
}

// A mailto: link the owner clicks to open their own email with everything filled in.
// They review it and press send there; the app never sends email itself.
export function mailtoLink(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to.trim()).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// What's left to pay on a bill after a dispute: the credit if one came, the claimed amount held back while it's open
export function amountToPay(total: number, dispute: { status: DisputeStatus; amount_claimed: number; amount_credited: number | null } | null) {
  if (!dispute) return total;
  if (dispute.status === "credited") return Math.round((total - Number(dispute.amount_credited ?? 0)) * 100) / 100;
  if (dispute.status === "sent" || dispute.status === "draft") return Math.round((total - Number(dispute.amount_claimed)) * 100) / 100;
  return total; // refused: the full bill stands
}
