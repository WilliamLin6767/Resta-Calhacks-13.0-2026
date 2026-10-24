// Which supplier to order each item from. Pure functions, no database calls and no AI.
// Compares every supplier with a price for the item: cost for the packs needed, whether it can
// arrive in time, and each supplier's order minimum. Claude only explains the result (planAi.ts).

export type Need = { ingredient_id: number; name: string; unit: string; qty: number; note: string };
export type Offer = { supplier_id: number; ingredient_id: number; pack_desc: string | null; pack_qty: number; price: number };
export type SupplierInfo = { id: number; name: string; min_order_amount: number; earliest_delivery: string };

export type Option = {
  supplier_id: number; supplier: string; packs: number; pack_desc: string | null;
  cost: number; unit_cost: number; arrives: string; on_time: boolean;
};
export type PlanLine = Need & { choice: Option; options: Option[]; preferred_supplier_id: number | null };
export type PlanGroup = {
  supplier_id: number; supplier: string; lines: PlanLine[]; total: number;
  min_order_amount: number; below_minimum: number; arrives: string; late: boolean;
};
export type Plan = {
  needed_by: string | null;
  groups: PlanGroup[];
  total: number;
  usual_total: number; // the same items, each from its preferred supplier
  savings: number;
  cant_order: Need[]; // no supplier has a price for these
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function optionsFor(need: Need, offers: Offer[], suppliers: Map<number, SupplierInfo>, neededBy: string | null): Option[] {
  return offers
    .filter((o) => o.ingredient_id === need.ingredient_id && suppliers.has(o.supplier_id) && Number(o.pack_qty) > 0)
    .map((o) => {
      const s = suppliers.get(o.supplier_id)!;
      const packs = Math.max(1, Math.ceil(need.qty / Number(o.pack_qty)));
      return {
        supplier_id: s.id, supplier: s.name, packs, pack_desc: o.pack_desc,
        cost: round2(packs * Number(o.price)), unit_cost: Number(o.price) / Number(o.pack_qty),
        arrives: s.earliest_delivery, on_time: !neededBy || s.earliest_delivery <= neededBy,
      };
    })
    // On time first, then cheapest, then earliest
    .sort((a, b) => Number(b.on_time) - Number(a.on_time) || a.cost - b.cost || a.arrives.localeCompare(b.arrives));
}

function groupLines(lines: PlanLine[], suppliers: Map<number, SupplierInfo>, neededBy: string | null): PlanGroup[] {
  const groups = new Map<number, PlanGroup>();
  for (const l of lines) {
    const s = suppliers.get(l.choice.supplier_id)!;
    const g = groups.get(s.id) ?? {
      supplier_id: s.id, supplier: s.name, lines: [], total: 0, min_order_amount: s.min_order_amount,
      below_minimum: 0, arrives: s.earliest_delivery, late: Boolean(neededBy && s.earliest_delivery > neededBy),
    };
    g.lines.push(l);
    g.total = round2(g.total + l.choice.cost);
    groups.set(s.id, g);
  }
  for (const g of groups.values()) g.below_minimum = round2(Math.max(0, g.min_order_amount - g.total));
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

// 1. Each item goes to the cheapest supplier that can arrive by `neededBy` (or the earliest, if none can).
// 2. A supplier order under its minimum is dropped if every item in it has another on-time supplier;
//    those items move to their next best option. Repeats until nothing changes.
export function planOrders(
  needs: Need[],
  offers: Offer[],
  supplierList: SupplierInfo[],
  preferred: Map<number, number | null>,
  neededBy: string | null,
): Plan {
  const suppliers = new Map(supplierList.map((s) => [s.id, s]));
  const cantOrder: Need[] = [];
  const lines: PlanLine[] = [];
  for (const need of needs) {
    const options = optionsFor(need, offers, suppliers, neededBy);
    if (!options.length) cantOrder.push(need);
    else lines.push({ ...need, choice: options[0], options, preferred_supplier_id: preferred.get(need.ingredient_id) ?? null });
  }

  const dropped = new Set<number>();
  for (let round = 0; round < 10; round++) {
    const small = groupLines(lines, suppliers, neededBy)
      .filter((g) => g.below_minimum > 0 && !dropped.has(g.supplier_id))
      .sort((a, b) => a.total - b.total)[0];
    if (!small) break;
    dropped.add(small.supplier_id);
    const moves = small.lines.map((l) => l.options.find((o) => o.on_time && !dropped.has(o.supplier_id)));
    if (moves.some((m) => !m)) continue; // can't move everything: keep it, flagged as under the minimum
    small.lines.forEach((l, i) => (l.choice = moves[i]!));
  }

  const groups = groupLines(lines, suppliers, neededBy);
  const total = round2(groups.reduce((s, g) => s + g.total, 0));
  const usual = round2(lines.reduce((s, l) => s + (l.options.find((o) => o.supplier_id === l.preferred_supplier_id) ?? l.choice).cost, 0));
  return { needed_by: neededBy, groups, total, usual_total: usual, savings: round2(usual - total), cant_order: cantOrder };
}

// Why this supplier, in a few words, for the order's reason line
export function choiceReason(line: PlanLine): string {
  const others = line.options.filter((o) => o.supplier_id !== line.choice.supplier_id);
  if (!line.choice.on_time) return "no supplier can deliver in time; this is the earliest";
  if (!others.length) return "the only supplier with a price";
  const cheaper = others.filter((o) => o.cost < line.choice.cost);
  if (!cheaper.length) return "cheapest that arrives in time";
  if (cheaper.every((o) => !o.on_time)) return "cheaper suppliers can't deliver in time";
  return "keeps another supplier's order above its minimum";
}
