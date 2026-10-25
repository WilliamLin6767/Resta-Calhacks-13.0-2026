// Which emailed orders the inbox takes: catering only. Everyday orders (one person's dinner) would
// flood the owner, so they're skipped with a reply pointing to phone or online ordering.
// Pure functions, no database or AI.

// Big enough to be catering even if the email doesn't say it's for an event
export const CATERING_MIN_TOTAL = 150;
export const CATERING_MIN_DISHES = 10;

export function isCatering(o: { catering: boolean; headcount: number; lines: { qty: number }[]; total: number }) {
  const dishes = o.lines.reduce((s, l) => s + l.qty, 0);
  return o.catering || o.headcount >= CATERING_MIN_DISHES || dishes >= CATERING_MIN_DISHES || o.total >= CATERING_MIN_TOTAL;
}

// A polite reply for an everyday order, opened in the owner's own email app
export function everydayOrderReply(to: string, name: string, restaurant: string) {
  const first = name.trim().split(/\s+/)[0] || "there";
  const body =
    `Hi ${first},\n\nThanks for thinking of us! We take everyday orders by phone or in person, so we can get them right and ready on time. ` +
    `Please give us a call, or order through DoorDash or Uber Eats.\n\nFor catering (events, office lunches, 10 or more dishes), email us any time.\n\n${restaurant}`;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`Your order with ${restaurant}`)}&body=${encodeURIComponent(body)}`;
}
