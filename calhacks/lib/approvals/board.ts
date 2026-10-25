// Everything waiting for the owner, for the Actions page (server only), filed by department
// (sections.ts): the assistant's and the loop's proposals, the "Needs you" items that are approvals
// (draft orders, price raises, delivery prices, savings moves, emailed orders), and the supplier
// calls the Actions page draws itself. The same decision never shows twice: a proposal to approve
// order #30 hides order #30's own Approve item, and a proposed call hides that call's card.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseActions, type ActionRow } from "@/lib/agent/actions";
import { loadBar } from "@/lib/attention/service";
import { TABS, type Item } from "@/lib/attention/types";
import { loadPicture } from "@/lib/intelligence/load";
import type { Discovery } from "@/lib/intelligence/types";
import { listCases } from "@/lib/loop/store";
import type { Suggestion } from "@/lib/pricing/pricing";
import { loadPricing } from "@/lib/pricing/service";
import { BOARD, isApprovalItem, itemOrderId, itemSection, placeAction, type BoardContext, type BoardSection, type Placed } from "./sections";

export type PlacedAction = ActionRow & { placed: Placed };
export type Board = {
  sections: Record<BoardSection, { actions: PlacedAction[]; items: Item[] }>;
  suggestions: Suggestion[]; // suggested menu prices, each approved (or changed) on its own card
  skipCallIds: number[]; // calls already on an action card
  errors: string[]; // what couldn't be loaded, said on the page
  context: BoardContext;
};

export async function boardContext(db: SupabaseClient): Promise<BoardContext> {
  const [cases, picture] = await Promise.all([listCases(db, { limit: 60 }).catch(() => []), loadPicture(db).catch(() => null)]);
  const discoveries = new Map<string, Discovery>((picture?.discoveries ?? []).map((d) => [d.key, d]));
  const caseDiscovery = new Map<number, Discovery>();
  for (const d of discoveries.values()) if (d.case) caseDiscovery.set(d.case.id, d);
  return { casePlaybook: new Map(cases.map((c) => [c.id, c.playbook])), caseDiscovery, discoveries };
}

export async function loadBoard(db: SupabaseClient): Promise<Board> {
  const errors: string[] = [];
  const [proposed, context, bars, pricing] = await Promise.all([
    supabaseActions(db).list({ status: "proposed", limit: 100 }).catch((e: unknown) => {
      errors.push(e instanceof Error ? e.message : String(e));
      return [] as ActionRow[];
    }),
    boardContext(db),
    Promise.allSettled(TABS.map((tab) => loadBar(db, tab))),
    loadPricing(db).catch((e: unknown) => {
      errors.push(`menu prices: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }),
  ]);
  // Raises first, then the ones that need a look; the per-dish cards replace the bar's "Approve all"
  const suggestions = pricing ? [...pricing.suggestions.filter((s) => s.action === "raise"), ...pricing.suggestions.filter((s) => s.action === "review")].filter((s) => s.new_price) : [];
  const now = new Date().toISOString();
  const actions = proposed.filter((a) => a.expires_at > now);

  const orderIds = new Set(actions.filter((a) => a.tool === "approve_purchase_order").map((a) => Number(a.args.order_id)));
  const skipCallIds = actions.filter((a) => a.tool === "place_call" || a.tool === "reject_call").map((a) => Number(a.args.call_id)).filter(Number.isFinite);

  const sections = Object.fromEntries(BOARD.map((s) => [s, { actions: [] as PlacedAction[], items: [] as Item[] }])) as Board["sections"];
  for (const a of actions) {
    const placed = placeAction(a, context);
    sections[placed.section].actions.push({ ...a, placed });
  }

  const seen = new Set<string>();
  bars.forEach((b, i) => {
    if (b.status === "rejected") {
      errors.push(`${TABS[i]}: ${b.reason instanceof Error ? b.reason.message : String(b.reason)}`);
      return;
    }
    for (const item of b.value.items) {
      if (!isApprovalItem(item) || seen.has(item.key) || (item.key === "raises" && pricing)) continue;
      const order = itemOrderId(item);
      if (order !== null && orderIds.has(order)) continue; // the proposal card already covers it
      seen.add(item.key);
      sections[itemSection(item)].items.push(item);
    }
  });

  return { sections, suggestions, skipCallIds, errors, context };
}
