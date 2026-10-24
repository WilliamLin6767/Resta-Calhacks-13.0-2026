// Purchase orders: the message to send a supplier, when it can arrive, and the supplier's minimum.
// Pure functions, no database calls.

export type OrderSupplier = {
  name: string; contact_name: string | null; phone: string | null; email: string | null;
  preferred_channel: string | null; lead_time_days: number | null; min_order_amount: number | null; delivery_days: string | null;
};
export type OrderLine = { qty: number; est_unit_price: number | null; ingredient: string; pack_desc: string | null };

// Allowed status changes. Received orders will update stock once inventory (A2) is connected.
export const NEXT_STATUS: Record<string, string[]> = {
  draft: ["approved", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["received", "cancelled"],
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The first delivery day at least `lead_time_days` after `today` (YYYY-MM-DD).
// delivery_days is like "Mon,Wed,Fri" or "daily"; anything else means "any day".
export function nextDeliveryDate(today: string, supplier: Pick<OrderSupplier, "lead_time_days" | "delivery_days">): string {
  const allowed = (supplier.delivery_days ?? "").split(",").map((d) => d.trim()).filter((d) => DAYS.includes(d));
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, supplier.lead_time_days ?? 1));
  for (let i = 0; i < 7 && allowed.length && !allowed.includes(DAYS[date.getUTCDay()]); i++) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function orderTotal(lines: OrderLine[]): number {
  return Math.round(lines.reduce((s, l) => s + Number(l.qty) * Number(l.est_unit_price ?? 0), 0) * 100) / 100;
}

// How far the order is below the supplier's minimum, or 0
export function belowMinimum(lines: OrderLine[], supplier: Pick<OrderSupplier, "min_order_amount">): number {
  return Math.max(0, Math.round((Number(supplier.min_order_amount ?? 0) - orderTotal(lines)) * 100) / 100);
}

// A short, plain order message the owner can send as is, e.g.
// "Hi Maria, this is Pho Berkeley. Can we order for Tue Oct 27: 3 x Brisket (15 lb case). Thank you!"
export function orderMessage(restaurant: string, supplier: OrderSupplier, lines: OrderLine[], deliveryDate: string): string {
  const day = new Date(`${deliveryDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const items = lines.map((l) => `${formatQty(l.qty)} x ${l.ingredient}${l.pack_desc ? ` (${l.pack_desc})` : ""}`).join(", ");
  const hello = supplier.contact_name ? `Hi ${supplier.contact_name}` : "Hi";
  return `${hello}, this is ${restaurant}. Can we order for ${day}: ${items}. Thank you!`;
}

// How to reach the supplier on their preferred channel. `href` opens the owner's own app
// (Messages, phone, email) with the message filled in; the owner presses send.
export function contactLink(supplier: OrderSupplier, message: string): { label: string; href: string | null } {
  const phone = (supplier.phone ?? "").replace(/[^\d+]/g, "");
  switch (supplier.preferred_channel) {
    case "text":
      return { label: "Text the order", href: phone ? `sms:${phone}?&body=${encodeURIComponent(message)}` : null };
    case "phone":
      return { label: `Call ${supplier.phone ?? ""}`.trim(), href: phone ? `tel:${phone}` : null };
    case "email":
      return {
        label: "Email the order",
        href: supplier.email ? `mailto:${supplier.email}?subject=${encodeURIComponent("Order")}&body=${encodeURIComponent(message)}` : null,
      };
    default: // WeChat, LINE, WhatsApp, portal: copy the message and paste it there
      return { label: `Copy for ${channelName(supplier.preferred_channel)}`, href: null };
  }
}

function channelName(channel: string | null) {
  return ({ wechat: "WeChat", line: "LINE", whatsapp: "WhatsApp", portal: "their portal" } as Record<string, string>)[channel ?? ""] ?? "the supplier";
}

function formatQty(qty: number) {
  return Number.isInteger(Number(qty)) ? String(Number(qty)) : Number(qty).toFixed(1);
}
