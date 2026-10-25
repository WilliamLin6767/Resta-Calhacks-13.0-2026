// The "Needs you" bar on each page: read its items, and hide one until it changes (the same
// service as /api/attention/dismiss).
import { z } from "zod";
import { dismiss, loadBar } from "@/lib/attention/service";
import { TABS, type Item, type Tab } from "@/lib/attention/types";
import { signalAfter } from "@/lib/live/signal";
import { resolveOne } from "../resolve";
import { ask, changed, json, defineTool, type AgentCtx } from "../types";

async function loadItems(ctx: AgentCtx, tab?: Tab) {
  const tabs = tab ? [tab] : TABS;
  const bars = await Promise.allSettled(tabs.map((t) => loadBar(ctx.db, t)));
  return bars.flatMap((b) => (b.status === "fulfilled" ? b.value.items : []));
}

const view = (i: Item) => ({ tab: i.tab, level: i.level, title: i.title, detail: i.detail, can_hide: Boolean(i.dismissable) });

export const attentionTools = [
  defineTool({
    name: "get_needs_you",
    description: `What each page's "Needs you" bar lists: act = needs a decision now, watch = keep an eye on, info. tab: ${TABS.join(", ")}, or leave out for all.`,
    input: z.object({ tab: z.enum(TABS).optional() }),
    run: async ({ tab }, ctx) => {
      const items = await loadItems(ctx, tab);
      return json({ count: items.length, items: items.slice(0, 30).map(view), more: Math.max(0, items.length - 30) });
    },
  }),
  defineTool({
    name: "dismiss_needs_you",
    description: 'Hide one alert from the "Needs you" bar until it changes. item: its title, as get_needs_you shows it. Only alerts with can_hide.',
    input: z.object({ item: z.string(), tab: z.enum(TABS).optional() }),
    run: async ({ item, tab }, ctx) => {
      const items = (await loadItems(ctx, tab)).filter((i) => i.dismissable);
      const found = resolveOne(items, item, (i) => i.title, "alert that can be hidden");
      if (!found.ok) return ask(found.ask);
      await dismiss(ctx.db, found.item.key, found.item.fingerprint);
      signalAfter("/api/attention/dismiss");
      return changed(ctx, { kind: "needs_you_hidden", label: `Hidden from Needs you: ${found.item.title}`, before: "shown", after: "hidden" });
    },
  }),
];
