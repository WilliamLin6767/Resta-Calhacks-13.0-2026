// Claude summarizes one tab for a busy owner (server only), from the items and numbers code worked
// out (build.ts). It points out what deserves a closer look; it doesn't decide anything.
import { z } from "zod";
import { ask } from "@/lib/purchasing/ai";
import { TAB_LABELS, type TabFacts } from "./types";

export const TabSummarySchema = z.object({
  headline: z.string(), // one sentence: the most important thing on this tab right now
  status: z.enum(["good", "watch", "act"]),
  look_closer: z.array(z.object({ title: z.string(), why: z.string() })), // up to 3
});
export type TabSummary = z.infer<typeof TabSummarySchema>;

const SYSTEM =
  "You write the summary at the top of one tab of a back-office app for a small Vietnamese restaurant. The owner is busy and may read only this. " +
  "You get the tab's to-do items (already worked out) and a few key numbers. " +
  "headline: one plain sentence on the most important thing right now, with its number. status: act if something needs a decision today, watch if something is trending the wrong way, good otherwise. " +
  "look_closer: up to 3 things worth investigating that the to-do items don't already say: patterns, risks, or connections between numbers (for example the same supplier causing several problems). " +
  "Each has a short title and one sentence why, citing numbers from the facts. Use only the numbers given; never invent any. If nothing deserves a closer look, return none.";

export async function summarizeTab(facts: TabFacts): Promise<TabSummary> {
  return ask(SYSTEM, `Tab: ${TAB_LABELS[facts.tab].label}\n${JSON.stringify(facts, null, 1)}`, TabSummarySchema, "low");
}
