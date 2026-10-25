// Findings: what needs the owner across the app, and hiding one until it changes (the same
// service as /api/attention/dismiss). Ranked by dollars a week, worked out in code (lib/attention/impact.ts).
import { z } from "zod";
import { dismiss, loadBar, loadTop } from "@/lib/attention/service";
import { TABS, type Item, type Tab } from "@/lib/attention/types";
import { signalAfter } from "@/lib/live/signal";
import { resolveOne } from "../resolve";
import { ask, changed, json, defineTool, type AgentCtx } from "../types";

async function loadItems(ctx: AgentCtx, tab?: Tab) {
  const tabs = tab ? [tab] : TABS;
  const bars = await Promise.allSettled(tabs.map((t) => loadBar(ctx.db, t)));
  return bars.flatMap((b) => (b.status === "fulfilled" ? b.value.items : []));
}

const view = (i: Item) => ({
  key: i.key, tab: i.tab, level: i.level, title: i.title, detail: i.detail,
  usd_per_week: i.impact_usd_week ?? null, basis: i.basis || undefined, confidence: i.confidence, evidence: i.evidence?.length ? i.evidence : undefined,
  can_hide: Boolean(i.dismissable),
});

export const findingTools = [
  defineTool({
    name: "get_findings",
    tier: "read",
    area: "findings",
    description:
      `What needs the owner most, ranked by dollars a week (worked out in code, with the basis and a confidence; demo = from planted demo data). ` +
      `act = needs a decision now. Leave tab out for the top findings across the app, or pick one: ${TABS.join(", ")}.`,
    input: z.object({ tab: z.enum(TABS).optional() }),
    run: async ({ tab }, ctx) => {
      if (!tab) {
        const top = await loadTop(ctx.db, 10);
        return json({ count: top.length, items: top.map(view) });
      }
      const items = await loadItems(ctx, tab);
      return json({ count: items.length, items: items.slice(0, 30).map(view), more: Math.max(0, items.length - 30) });
    },
  }),
  defineTool({
    name: "dismiss_finding",
    tier: "record",
    area: "findings",
    description: "Hide one finding until it changes. item: its title, as get_findings shows it. Only findings with can_hide.",
    input: z.object({ item: z.string(), tab: z.enum(TABS).optional() }),
    run: async ({ item, tab }, ctx) => {
      const items = (await loadItems(ctx, tab)).filter((i) => i.dismissable);
      const found = resolveOne(items, item, (i) => i.title, "finding that can be hidden");
      if (!found.ok) return ask(found.ask);
      await dismiss(ctx.db, found.item.key, found.item.fingerprint);
      signalAfter("/api/attention/dismiss");
      return changed(ctx, { kind: "finding_hidden", label: `Hidden: ${found.item.title}`, before: "shown", after: "hidden" });
    },
  }),
];
