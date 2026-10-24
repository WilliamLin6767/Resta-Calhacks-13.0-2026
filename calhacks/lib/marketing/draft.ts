import { z } from "zod";
import { ask } from "@/lib/purchasing/ai";
import { finishCopy, type DraftPost, type PostLayout } from "@/lib/marketing/copy";
import type { Slot } from "@/lib/marketing/targets";

const CopySchema = z.object({
  posts: z.array(
    z.object({
      headline: z.string(),
      subhead: z.string(),
      caption: z.string(),
      hashtags: z.array(z.string()),
    }),
  ),
});

const VOICES = [
  "Write like a text to a regular: short, familiar, a little playful.",
  "Write like a late-night special: direct, hungry, no small talk.",
  "Write like a chalkboard note: plain words, one concrete detail about the dish.",
  "Write like you're talking across the counter: warm, specific, unhurried.",
];

const SYSTEM =
  "You write Instagram posts for a small restaurant that cannot hire a marketing agency. " +
  "Follow the voice note. No emoji. " +
  "Do not invent a price, an award, or a dish that is not in the assignment. " +
  "Do not mention sales numbers, margins, or words like puzzle, dog, or analytics. " +
  "A boost post invites people to order a dish already on the menu. " +
  "A poll post asks whether the restaurant should add a dish it does not serve yet. The caption must tell people to comment ADD or SKIP. " +
  "headline is at most 6 words. subhead is one sentence. caption is two or three sentences. hashtags are 4 to 6 words without the # sign. " +
  "Return one post per assignment, in the same order. Do not repeat a headline you would have used for a different voice.";

export function voiceFor(offset: number): string {
  return VOICES[((offset % VOICES.length) + VOICES.length) % VOICES.length];
}

export type DraftContext = {
  name: string;
  cuisine: string | null;
  address: string | null;
  slots: Slot[];
  voice: string;
};

export async function draftPosts(context: DraftContext): Promise<DraftPost[]> {
  if (context.slots.length === 0) return [];
  const assignments = context.slots
    .map((slot, index) => `${index + 1}. ${slot.kind === "poll" ? "Poll" : "Boost"} — ${slot.dish}. ${slot.why}`)
    .join("\n");
  const content = [`Restaurant: ${context.name}`, `Cuisine: ${context.cuisine ?? "not set"}`, `Address: ${context.address ?? "not set"}`, `Voice: ${context.voice}`, "", "Assignments:", assignments].join("\n");

  const parsed = await ask(SYSTEM, content, CopySchema, "medium");
  return context.slots.map((slot, index) => {
    const copy = parsed.posts[index] ?? { headline: slot.dish, subhead: slot.why, caption: slot.why, hashtags: [] };
    const layout = (slot.kind === "poll" ? (slot.look === "poster" ? "poll-poster" : "poll") : slot.look === "poster" ? "boost-poster" : "boost") as PostLayout;
    return finishCopy({
      layout,
      dish_name: slot.dish,
      headline: copy.headline || slot.dish,
      subhead: copy.subhead || slot.why,
      caption: copy.caption || slot.why,
      hashtags: copy.hashtags,
    });
  });
}
