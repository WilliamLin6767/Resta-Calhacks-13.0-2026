import { TARGET_FOOD_COST } from "@/lib/pricing/pricing";
import { isOnMenu } from "@/lib/trends/score";

export type MenuPerformance = {
  name: string;
  units: number;
  units_change_pct: number | null;
  class: "star" | "plowhorse" | "puzzle" | "dog" | null;
  // Optional, when known: margin in dollars a plate, food cost %, days since it was last posted,
  // and whether stock covers a promotion week (the same check as campaign_options).
  margin_usd?: number | null;
  food_cost_pct?: number | null;
  posted_days_ago?: number | null;
  stock_covers?: boolean | null;
};

export const REPOST_AFTER_DAYS = 14;

// Worth a push: food cost on target (so the margin holds), not posted in the last two weeks, and
// enough stock for the extra orders a promotion brings. Unknown values don't rule a dish out.
export function eligible(dish: MenuPerformance): boolean {
  if (dish.food_cost_pct != null && dish.food_cost_pct > TARGET_FOOD_COST * 100) return false;
  if (dish.posted_days_ago != null && dish.posted_days_ago < REPOST_AFTER_DAYS) return false;
  if (dish.stock_covers === false) return false;
  return true;
}

// Higher margin in dollars first; dishes without a known margin keep their order.
const byMargin = (a: MenuPerformance, b: MenuPerformance) => (b.margin_usd ?? 0) - (a.margin_usd ?? 0);

export type Slot = {
  kind: "boost" | "poll";
  dish: string;
  why: string;
  look: "classic" | "poster";
};

function unique(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function whyBoost(dish: MenuPerformance): string {
  if (dish.class === "puzzle") return "It makes money, and fewer people order it than the rest of the menu.";
  if (dish.units_change_pct !== null && dish.units_change_pct <= -10) {
    return `Orders are down ${Math.abs(dish.units_change_pct)}% from the period before.`;
  }
  if (dish.class === "dog") return "It sells less than the rest of the menu.";
  return "It is one of the quietest dishes on the menu.";
}

// Puzzles first: profitable dishes Analytics says to promote (highest margin in dollars first). Then
// dishes whose orders fell, then the quietest. Only dishes that pass eligible().
export function boostCandidates(all: MenuPerformance[]): MenuPerformance[] {
  const menu = all.filter(eligible);
  const puzzles = menu.filter((dish) => dish.class === "puzzle").sort((a, b) => byMargin(a, b) || a.units - b.units);
  const falling = menu
    .filter((dish) => dish.class !== "star" && dish.units_change_pct !== null && dish.units_change_pct <= -10)
    .sort((a, b) => (a.units_change_pct ?? 0) - (b.units_change_pct ?? 0) || byMargin(a, b));
  const dogs = menu.filter((dish) => dish.class === "dog").sort((a, b) => a.units - b.units);
  const quiet = [...menu].sort((a, b) => a.units - b.units);
  const order = unique([...puzzles, ...falling, ...dogs, ...quiet].map((dish) => dish.name));
  const byName = new Map(menu.map((dish) => [dish.name, dish]));
  return order.flatMap((name) => {
    const dish = byName.get(name);
    return dish ? [dish] : [];
  });
}

export function pollCandidates(recommendations: string[], menuNames: string[]): string[] {
  return unique(recommendations).filter((dish) => !isOnMenu(dish, menuNames));
}

function rotate<T>(items: T[], by: number): T[] {
  if (items.length === 0) return items;
  const shift = ((by % items.length) + items.length) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

// One push for a quiet dish, then polls for trend dishes that are not on the menu yet.
// `offset` moves the starting dish and the layout so a new draft is not a copy of the last one.
export function planWeek(menu: MenuPerformance[], recommendations: string[], offset = 0): Slot[] {
  const boosts = rotate(boostCandidates(menu), offset);
  const polls = rotate(pollCandidates(recommendations, menu.map((dish) => dish.name)), offset);
  const slots: Slot[] = [];
  const used = new Set<string>();
  const pollsFirst = offset % 2 === 1;

  const take = (kind: "boost" | "poll") => {
    if (kind === "boost") {
      const dish = boosts.find((item) => !used.has(item.name));
      if (!dish) return false;
      used.add(dish.name);
      slots.push({ kind, dish: dish.name, why: whyBoost(dish), look: slots.length % 2 === 0 ? "classic" : "poster" });
      return true;
    }
    const dish = polls.find((name) => !used.has(name));
    if (!dish) return false;
    used.add(dish);
    slots.push({ kind, dish, why: "People nearby are asking for it, and it is not on the menu.", look: slots.length % 2 === 0 ? "poster" : "classic" });
    return true;
  };

  if (pollsFirst) take("poll");
  else take("boost");
  if (pollsFirst) take("boost");
  else take("poll");
  if (!take(pollsFirst ? "boost" : "poll")) take(pollsFirst ? "poll" : "boost");
  while (slots.length < 3 && (take("poll") || take("boost"))) {
    // fill the week from whichever list still has a dish
  }
  return slots.slice(0, 3);
}
