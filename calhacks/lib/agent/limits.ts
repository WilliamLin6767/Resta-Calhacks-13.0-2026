// The hard limits on Commit actions, in one place. Checked when an action is proposed and again
// in code right before it runs (lib/agent/actions.ts), so a stale or edited proposal can't pass.
import { MAX_RAISE, TARGET_FOOD_COST } from "@/lib/pricing/pricing";

export const PO_MAX_USD = 1500; // a single purchase order
export const MAX_PRICE_CHANGE = MAX_RAISE; // 10% per menu price change (pricing.ts)
export const MAX_PROMO_DISCOUNT_USD = 2;
export const PROMO_FOOD_COST_MAX = TARGET_FOOD_COST; // a discount must keep food cost at or under 30%

export type LimitCheck = { ok: true } | { ok: false; reason: string };
const ok: LimitCheck = { ok: true };
const no = (reason: string): LimitCheck => ({ ok: false, reason });
const money = (n: number) => `$${n.toFixed(2)}`;

// The agent and the loop can't approve an order over $1,500. The owner's own Approve button on the
// Invoices page isn't capped (it never was); it is still logged.
export function checkPurchaseOrder(total: number, source: "agent" | "loop" | "owner" = "agent"): LimitCheck {
  if (!Number.isFinite(total) || total <= 0) return no("The order has no total.");
  if (source === "owner") return ok;
  return total > PO_MAX_USD ? no(`This order is ${money(total)}, over the ${money(PO_MAX_USD)} limit for one order. Split it or approve it on the Invoices page.`) : ok;
}

// The agent and the loop may move a price by at most 10%. The owner typing a price on the Menu
// page isn't capped (they can already set any price there); it is still logged.
export function checkMenuPrice(oldPrice: number, newPrice: number, source: "agent" | "loop" | "owner"): LimitCheck {
  if (!Number.isFinite(newPrice) || newPrice <= 0 || newPrice >= 1000) return no("Enter a price between $0 and $1,000.");
  if (source === "owner") return ok;
  const change = Math.abs(newPrice - oldPrice) / oldPrice;
  return change > MAX_PRICE_CHANGE + 1e-9 ? no(`${money(oldPrice)} to ${money(newPrice)} is a ${(change * 100).toFixed(1)}% change; the limit is ${MAX_PRICE_CHANGE * 100}% at a time.`) : ok;
}

export function checkDiscount(discount: number, price: number, unitFoodCost: number): LimitCheck {
  if (discount < 0) return no("A discount can't be negative.");
  if (discount > MAX_PROMO_DISCOUNT_USD) return no(`The most a promotion can take off is ${money(MAX_PROMO_DISCOUNT_USD)}.`);
  if (discount > 0 && unitFoodCost / (price - discount) > PROMO_FOOD_COST_MAX + 1e-9) return no(`At ${money(discount)} off, food cost would go over ${PROMO_FOOD_COST_MAX * 100}%.`);
  return ok;
}

// A post about a dish needs the dish on the menu and the stock to sell a promo week.
export function checkPublish(dish: { active: boolean } | null, stockCovers: boolean | null): LimitCheck {
  if (dish && !dish.active) return no("That dish isn't on the menu any more.");
  if (stockCovers === false) return no("Stock can't cover a promotion week for this dish. Restock first.");
  return ok;
}

export function checkMoneyMove(amount: number): LimitCheck {
  return Number.isFinite(amount) && amount > 0 ? ok : no("Enter an amount above $0.");
}

export function checkReserve(amount: number): LimitCheck {
  return Number.isFinite(amount) && amount >= 0 ? ok : no("Enter a reserve of $0 or more.");
}
