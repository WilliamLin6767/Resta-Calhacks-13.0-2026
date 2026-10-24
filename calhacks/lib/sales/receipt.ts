// Customer receipts: check what was read against the menu, and work out what the dishes used.
// Pure functions, no database calls and no AI.

export type MenuRef = { id: number; name: string; price: number };
export type RecipeRow = { menu_item_id: number; ingredient_id: number; qty: number };
export type ReceiptLine = { printed: string; menu_item_id: number; qty: number; unit_price: number; line_total: number };

// Rounding slack when comparing money, in dollars
const CENTS = 0.02;

// Problems worth a look before adding the receipt to sales. None of them block saving
// (a happy-hour price is not an error); unmatched lines do, because their ingredients are unknown.
export function checkReceipt(lines: ReceiptLine[], menu: MenuRef[], subtotal: number | null): string[] {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const notes: string[] = [];
  for (const l of lines) {
    const dish = byId.get(l.menu_item_id);
    if (!dish) {
      notes.push(`"${l.printed}" isn't matched to a dish yet.`);
      continue;
    }
    if (Math.abs(l.unit_price - dish.price) > CENTS) {
      notes.push(`${dish.name} was charged $${l.unit_price.toFixed(2)}; the menu says $${dish.price.toFixed(2)}.`);
    }
    if (l.line_total && Math.abs(l.qty * l.unit_price - l.line_total) > CENTS) {
      notes.push(`"${l.printed}": ${l.qty} x $${l.unit_price.toFixed(2)} isn't the $${l.line_total.toFixed(2)} printed.`);
    }
  }
  const sum = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  if (subtotal && Math.abs(sum - subtotal) > CENTS) {
    notes.push(`The lines add up to $${sum.toFixed(2)}, but the subtotal says $${subtotal.toFixed(2)}.`);
  }
  return notes;
}

// Ingredients the receipt's dishes use: quantity x recipe, per ingredient, in its own unit
export function ingredientUse(lines: { menu_item_id: number; qty: number }[], recipes: RecipeRow[]): Map<number, number> {
  const use = new Map<number, number>();
  for (const l of lines) {
    for (const r of recipes) {
      if (r.menu_item_id === l.menu_item_id) use.set(r.ingredient_id, (use.get(r.ingredient_id) ?? 0) + l.qty * Number(r.qty));
    }
  }
  return use;
}

export type StockBefore = { id: number; name: string; unit: string; estimated: number; status: "out" | "low" | "ok"; days_left: number | null };
export type Impact = {
  ingredient_id: number; name: string; unit: string;
  before: number; after: number; used: number;
  status_before: StockBefore["status"]; status_after: StockBefore["status"]; days_left: number | null;
};

// Stock before vs after the receipt, for every ingredient it touched; the ones that just became
// low or ran out come first.
export function stockImpact(before: StockBefore[], after: StockBefore[]): Impact[] {
  const afterById = new Map(after.map((a) => [a.id, a]));
  const rank = { out: 0, low: 1, ok: 2 };
  return before
    .map((b) => {
      const a = afterById.get(b.id) ?? b;
      return {
        ingredient_id: b.id, name: b.name, unit: b.unit,
        before: b.estimated, after: a.estimated, used: Math.round((b.estimated - a.estimated) * 10) / 10,
        status_before: b.status, status_after: a.status, days_left: a.days_left,
      };
    })
    .filter((i) => i.used > 0)
    .sort((x, y) => {
      const newly = (i: Impact) => (i.status_after !== i.status_before ? 0 : 1);
      return newly(x) - newly(y) || rank[x.status_after] - rank[y.status_after] || y.used - x.used;
    });
}
