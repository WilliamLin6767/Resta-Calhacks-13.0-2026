// Customer receipts on top of Supabase (server only).
//   loadMenu     - the dishes and prices a receipt is matched against
//   saveReceipt  - a receipt the owner checked becomes an order; returns what it did to stock
// Stock isn't changed directly: inventory works out "stock now" from sales x recipes
// (lib/inventory/stock.ts), so a new order lowers it as soon as it's saved.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadInventory } from "@/lib/inventory/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { stockImpact, type MenuRef } from "./receipt";

type Db = SupabaseClient;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

export async function loadMenu(db: Db): Promise<MenuRef[]> {
  const rows = must(
    await db.from("menu_items").select("id, name, price").eq("restaurant_id", RESTAURANT_ID).eq("active", true).order("id"),
    "load the menu",
  ) as { id: number; name: string; price: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, price: Number(r.price) }));
}

export type ReceiptInput = {
  receipt_number: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  channel: "dine_in" | "takeout";
  lines: { menu_item_id: number; qty: number; unit_price: number }[];
  tax: number;
  tip: number;
  total: number;
};

export async function saveReceipt(db: Db, r: ReceiptInput, source: "photo" | "manual") {
  const menu = new Map((await loadMenu(db)).map((m) => [m.id, m]));
  if (!r.lines.length) throw new Error("The receipt has no dishes.");
  for (const l of r.lines) {
    if (!menu.has(l.menu_item_id)) throw new Error("Pick a dish for every line first.");
    if (!Number.isInteger(l.qty) || l.qty <= 0 || l.qty > 100) throw new Error("Each line needs a whole quantity.");
  }
  if (r.receipt_number) {
    const dup = must(
      await db.from("sales_receipts").select("id").eq("restaurant_id", RESTAURANT_ID).eq("receipt_number", r.receipt_number).eq("receipt_date", r.date).limit(1),
      "check for this receipt",
    ) as { id: number }[];
    if (dup.length) throw new Error(`Receipt ${r.receipt_number} from ${r.date} was already added.`);
  }

  const before = (await loadInventory(db)).lines;
  const subtotal = Math.round(r.lines.reduce((s, l) => s + l.qty * l.unit_price, 0) * 100) / 100;
  const order = must(
    await db.from("orders").insert({
      restaurant_id: RESTAURANT_ID,
      ordered_at: `${r.date} ${r.time}:00 America/Los_Angeles`, // Postgres reads the time zone name
      channel: r.channel, subtotal, tax: r.tax || 0, tip: r.tip || 0, platform_fee: 0,
    }).select("id").single(),
    "save the order",
  ) as { id: number };
  must(
    await db.from("order_items").insert(r.lines.map((l) => ({ order_id: order.id, menu_item_id: l.menu_item_id, qty: l.qty, unit_price: l.unit_price }))),
    "save the dishes",
  );
  must(
    await db.from("sales_receipts").insert({
      restaurant_id: RESTAURANT_ID, order_id: order.id, receipt_number: r.receipt_number || null, receipt_date: r.date, total: r.total || null, source,
    }),
    "save the receipt",
  );

  const after = (await loadInventory(db)).lines;
  const impact = stockImpact(before, after);
  return {
    order_id: order.id,
    impact,
    alerts: impact.filter((i) => i.status_after !== "ok" && i.status_after !== i.status_before),
  };
}
