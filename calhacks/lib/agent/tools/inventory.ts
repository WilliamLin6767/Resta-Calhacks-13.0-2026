// Stock: what's on hand, counts and waste (the same services as /api/inventory/counts and /waste).
import { z } from "zod";
import { WASTE_REASONS, loadInventory, logWaste, saveCounts } from "@/lib/inventory/service";
import { signalAfter } from "@/lib/live/signal";
import { checkIngredient } from "@/lib/purchasing/restock";
import { outlierQuestion, resolveOne, toIngredientQty } from "../resolve";
import { ask, capped, json, round2, defineTool, type AgentCtx, type Change } from "../types";

type Inventory = Awaited<ReturnType<typeof loadInventory>>;
type Line = Inventory["lines"][number];

const amountItem = {
  ingredient: z.string().describe("The food as the owner said it, e.g. 'limes'"),
  amount: z.number().describe("The number the owner said"),
  unit: z.string().optional().describe("The unit the owner said (lb, case, each, oz...). Leave out if they didn't say one"),
};

// Each item resolved to one line and an amount in its own unit, or the questions to ask instead.
function resolveAmounts(inv: Inventory, items: { ingredient: string; amount: number; unit?: string }[]) {
  const asks: string[] = [];
  const out: { line: Line; qty: number; note?: string }[] = [];
  for (const item of items) {
    const found = resolveOne(inv.lines, item.ingredient, (l) => l.name, "ingredient");
    if (!found.ok) {
      asks.push(found.ask);
      continue;
    }
    const line = found.item;
    const qty = toIngredientQty(item.amount, item.unit, { name: line.name, unit: line.unit, pack_qty: inv.packQty[line.id] ?? null, pack_desc: inv.sources[line.id]?.pack_desc ?? null });
    if (!qty.ok) asks.push(qty.ask);
    else out.push({ line, qty: round2(qty.qty), note: qty.note });
  }
  return { asks, out };
}

// Several changes at once: each is collected, and Claude gets the list.
function changedAll(ctx: AgentCtx, changes: Change[]) {
  ctx.changes.push(...changes);
  return json({ ok: true, changes });
}

export const inventoryTools = [
  defineTool({
    name: "list_inventory",
    description: "Stock on hand for every ingredient: estimated quantity now, par, status (out, low, ok) and days left. filter: 'low' (out or low only), 'all', or a category name.",
    input: z.object({ filter: z.string().optional() }),
    run: async ({ filter }, ctx) => {
      const { lines } = await loadInventory(ctx.db);
      const f = (filter ?? "all").trim().toLowerCase();
      const picked = f === "low" ? lines.filter((l) => l.status !== "ok") : f === "all" || !f ? lines : lines.filter((l) => (l.category ?? "").toLowerCase() === f);
      return json(capped(picked.map((l) => ({ id: l.id, name: l.name, unit: l.unit, on_hand: round2(l.estimated), par: l.par_level, status: l.status, days_left: l.days_left, category: l.category }))));
    },
  }),
  defineTool({
    name: "check_ingredient",
    description: "Stock on hand, par, and the suppliers who sell one ingredient. Pass the food name the owner said.",
    input: z.object({ ingredient: z.string() }),
    run: async ({ ingredient }, ctx) => json(await checkIngredient(ctx.db, ingredient)),
  }),
  defineTool({
    name: "set_stock_count",
    description:
      "Save what the owner counted (sets stock to that amount). One item per food. Names, units ('2 cases') and odd counts are checked in code: " +
      "if it returns ask, say only that question. Pass confirm: true only when retrying after the owner said yes to a 'Did you mean' question.",
    input: z.object({ items: z.array(z.object(amountItem)).min(1).max(20), confirm: z.boolean().optional() }),
    run: async ({ items, confirm }, ctx) => {
      const inv = await loadInventory(ctx.db);
      const { asks, out } = resolveAmounts(inv, items);
      if (!confirm) {
        for (const { line, qty } of out) {
          const odd = outlierQuestion(qty, { name: line.name, unit: line.unit, par: line.par_level, expected: round2(line.estimated) });
          if (odd) asks.push(odd);
        }
      }
      if (asks.length) return ask(asks.join(" "));
      await saveCounts(ctx.db, out.map(({ line, qty }) => ({ ingredient_id: line.id, qty })), ctx.spoken ? "voice" : "manual");
      signalAfter("/api/inventory/counts");
      return changedAll(
        ctx,
        out.map(({ line, qty, note }) => {
          const before = round2(line.estimated);
          return {
            kind: "stock_count",
            label: `${line.name}: ${before} ${line.unit} to ${qty} ${line.unit}${note ? ` (${note})` : ""}`,
            before,
            after: qty,
            undo: { kind: "stock_count", ingredient_id: line.id, qty: before, name: line.name, unit: line.unit },
          };
        }),
      );
    },
  }),
  defineTool({
    name: "log_waste",
    description: `Log food thrown out (lowers stock). reason: ${WASTE_REASONS.join(", ")}. If it returns ask, say only that question.`,
    input: z.object({ items: z.array(z.object({ ...amountItem, reason: z.enum(WASTE_REASONS).optional() })).min(1).max(20) }),
    run: async ({ items }, ctx) => {
      const inv = await loadInventory(ctx.db);
      const { asks, out } = resolveAmounts(inv, items);
      const zero = out.filter((o) => o.qty <= 0).map((o) => `How much ${o.line.name} was thrown out?`);
      if (asks.length || zero.length) return ask([...asks, ...zero].join(" "));
      const reasons = items.map((i) => i.reason ?? "other");
      await logWaste(ctx.db, out.map(({ line, qty }, i) => ({ ingredient_id: line.id, qty, reason: reasons[i] })), ctx.spoken ? "voice" : "manual");
      signalAfter("/api/inventory/waste");
      return changedAll(
        ctx,
        out.map(({ line, qty }, i) => {
          const before = round2(line.estimated);
          const after = round2(Math.max(0, before - qty));
          return {
            kind: "waste",
            label: `${line.name}: ${qty} ${line.unit} thrown out (${reasons[i]}), ${before} to ${after} ${line.unit}`,
            before,
            after,
            undo: { kind: "waste", ingredient_id: line.id, qty: before, name: line.name, unit: line.unit },
          };
        }),
      );
    },
  }),
];
