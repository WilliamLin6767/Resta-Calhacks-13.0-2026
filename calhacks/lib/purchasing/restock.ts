// Spoken restock. Looks up one ingredient and, only if it is low, drafts one purchase order.
// The order stays draft. The owner approves it. This never sends anything.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadInventory, todayLocal } from "@/lib/inventory/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { choiceReason, type PlanLine } from "./plan";
import { buildPlan } from "./planService";
import { loadSources } from "./sources";

type Db = SupabaseClient;

function stem(word: string) {
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

function words(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map(stem)
    .filter((word) => word.length > 2);
}

// "beef bone" matches "Beef bones". Every word in the request has to show up in the name.
export function nameMatches(name: string, query: string) {
  const wanted = words(query);
  const have = words(name);
  if (!wanted.length || !have.length) return false;
  return wanted.every((word) => have.some((part) => part === word || part.includes(word) || word.includes(part)));
}

export type IngredientCheck = {
  name: string;
  unit: string;
  on_hand: number;
  par: number | null;
  status: string;
  days_left: number | null;
  suppliers: { name: string; pack: string | null; price: number }[];
};

export async function checkIngredient(db: Db, query: string): Promise<{ found: boolean; matches: IngredientCheck[] }> {
  const { lines } = await loadInventory(db);
  const hits = lines.filter((line) => nameMatches(line.name, query)).slice(0, 3);
  if (!hits.length) return { found: false, matches: [] };
  const { offers, suppliers } = await loadSources(db, todayLocal());
  const names = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  return {
    found: true,
    matches: hits.map((line) => ({
      name: line.name,
      unit: line.unit,
      on_hand: line.estimated,
      par: line.par_level,
      status: line.status,
      days_left: line.days_left,
      suppliers: offers
        .filter((offer) => offer.ingredient_id === line.id)
        .map((offer) => ({ name: names.get(offer.supplier_id) ?? "Supplier", pack: offer.pack_desc, price: offer.price })),
    })),
  };
}

export type DraftRestock =
  | { drafted: false; reason: string }
  | {
      drafted: true;
      orderId: number;
      supplier: string;
      lines: { name: string; packs: number; pack: string | null; price: number }[];
      total: number;
    };

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

// One draft order for the low-stock lines that match the spoken name. Not approved and not sent.
export async function draftRestock(db: Db, query: string): Promise<DraftRestock> {
  const { plan } = await buildPlan(db, { kind: "low" });
  const matches = plan.groups.flatMap((group) =>
    group.lines.filter((line) => nameMatches(line.name, query)).map((line) => ({ group, line })),
  );
  if (!matches.length) {
    const blocked = plan.cant_order.filter((need) => nameMatches(need.name, query));
    if (blocked.length) {
      return { drafted: false, reason: `${blocked.map((need) => need.name).join(", ")} has no supplier price on file. No order was drafted.` };
    }
    const check = await checkIngredient(db, query);
    if (!check.found) return { drafted: false, reason: `No ingredient matches "${query}". No order was drafted.` };
    const name = check.matches.map((match) => match.name).join(", ");
    return { drafted: false, reason: `${name} is not low enough to restock. No order was drafted.` };
  }

  const bySupplier = new Map<number, { group: (typeof matches)[number]["group"]; lines: PlanLine[] }>();
  for (const match of matches) {
    const existing = bySupplier.get(match.group.supplier_id);
    if (existing) existing.lines.push(match.line);
    else bySupplier.set(match.group.supplier_id, { group: match.group, lines: [match.line] });
  }
  const chosen = [...bySupplier.values()].sort((a, b) => lineCost(b.lines) - lineCost(a.lines))[0];
  const group = chosen.group;
  const lines = chosen.lines;
  const total = Math.round(lineCost(lines) * 100) / 100;
  const below = Math.max(0, group.min_order_amount - total);
  const warning = below > 0 ? ` This order is $${below.toFixed(2)} under their $${group.min_order_amount.toFixed(2)} minimum.` : "";
  const po = must(
    await db.from("purchase_orders").insert({
      restaurant_id: RESTAURANT_ID,
      supplier_id: group.supplier_id,
      status: "draft",
      created_by: "ai",
      expected_date: plan.needed_by,
      reason: `Voice restock. ${lines.map((line) => lineReason(line)).join("; ")}.${warning}`,
    }).select("id").single(),
    "create the order",
  ) as { id: number };
  must(
    await db.from("purchase_order_lines").insert(
      lines.map((line) => ({
        purchase_order_id: po.id,
        ingredient_id: line.ingredient_id,
        qty: line.choice.packs,
        est_unit_price: line.choice.packs > 0 ? line.choice.cost / line.choice.packs : line.choice.cost,
      })),
    ),
    "add the order lines",
  );
  return {
    drafted: true,
    orderId: po.id,
    supplier: group.supplier,
    total,
    lines: lines.map((line) => ({
      name: line.name,
      packs: line.choice.packs,
      pack: line.choice.pack_desc,
      price: line.choice.cost,
    })),
  };
}

function lineCost(lines: PlanLine[]) {
  return lines.reduce((sum, line) => sum + line.choice.cost, 0);
}

function lineReason(line: PlanLine) {
  return `${line.name}: ${line.note} (${choiceReason(line)})`;
}
