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

// Bump when the instructions change, so summaries saved under the old ones are rewritten
export const SUMMARY_VERSION = 2;

const SYSTEM =
  "You write the summary at the top of one tab of a back-office app for a small Vietnamese restaurant. The owner is busy, reads it on a phone between services, and may read only the headline. " +
  "You get the tab's to-do items (already worked out) and a few key numbers. " +
  "headline: one plain sentence, at most 18 words, saying the single most important thing and its number. Write like you're talking to the owner (you, your). No jargon. " +
  "status: act if something needs a decision today, watch if something is trending the wrong way, good otherwise. " +
  "look_closer: at most 2 things worth investigating that the to-do items don't already say, such as a pattern or a risk. Skip it if nothing qualifies. " +
  "Each: title of at most 6 words, why of at most 20 words with one number. Use only numbers from the facts; never invent any.";

export async function summarizeTab(facts: TabFacts): Promise<TabSummary> {
  return ask(SYSTEM, `Tab: ${TAB_LABELS[facts.tab].label}\n${JSON.stringify(facts, null, 1)}`, TabSummarySchema, "low");
}
