// One Claude turn for the owner chat. Typed and spoken messages share the app's agent tools
// (lib/agent/registry.ts), so the owner can look anything up and make everyday changes by chat
// or voice. Orders stay drafts. This never approves or sends one.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { buildTools, createCtx } from "@/lib/agent/registry";
import type { AgentLink, Change, DraftedOrder } from "@/lib/agent/types";
import { getSupabase } from "@/lib/supabase";

const AI_MODEL = "claude-sonnet-5-5";

const RULES = [
  "Use the conversation so far.",
  "Get every number from your tools. Never invent a number.",
  "Do ordinary updates right away (counts, waste, sales, drafts). Don't ask first.",
  "After any change, say what changed in one short sentence, with the old and new amounts.",
  "If a tool returns ask, say only that question. If the owner moves on to something else, drop it: don't bring it up again.",
  "Never say something changed unless a tool returned ok: true for it. If a tool returned an Error, say it didn't work and why.",
  "For anything that needs a photo or a file (scanning an invoice or a receipt, counting from a shelf photo), use open_page.",
  "Use check_ingredient when they mention a food. Use draft_restock when they want it restocked.",
  "Never approve or send an order. draft_restock only creates a draft.",
  "If the ingredient is not low, say so and do not draft an order.",
  "If you drafted an order, name the supplier and the packs, and tell them to tap Approve.",
].join("\n");

const SPOKEN_PROMPT = `The owner is talking while working. Answer out loud, in under 60 words.\n${RULES}`;
const TYPED_PROMPT = `The owner is chatting while working. Answer in a short paragraph.\n${RULES}`;

const TurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2000),
});

export type Turn = z.infer<typeof TurnSchema>;

export type { DraftedOrder };

export type Reply = { answer: string; order: DraftedOrder | null; changes: Change[]; links: AgentLink[] };

// Keep the last 12 turns, folded so roles alternate and the thread ends with the owner.
export function takeTurns(input: unknown): Turn[] | null {
  if (!Array.isArray(input)) return null;
  const parsed = z.array(TurnSchema).safeParse(input.slice(-12));
  if (!parsed.success) return null;
  const turns: Turn[] = [];
  for (const turn of parsed.data) {
    const last = turns[turns.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n${turn.content}`.slice(0, 2000);
    else turns.push({ ...turn });
  }
  while (turns[0]?.role === "assistant") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return null;
  return turns;
}

// The changes earlier in this conversation that can be undone, so "undo that" works: undo_change
// only accepts one of these payloads.
function historyNote(history: Change[]) {
  const undoable = history.filter((c) => c.undo).slice(-10);
  if (!undoable.length) return "";
  return `\n\nChanges earlier in this conversation that can be undone (newest last). To undo one, pass its payload to undo_change:\n${undoable
    .map((c) => `- ${c.label}: ${JSON.stringify(c.undo)}`)
    .join("\n")}`;
}

// identity: the visitor, for the AI tools' rate limits. history: changes from earlier in the conversation.
export async function replyToOwner(messages: Turn[], spoken: boolean, opts: { identity?: string; history?: Change[] } = {}): Promise<Reply> {
  const ctx = createCtx({ db: await getSupabase(), kind: "chat", spoken, identity: opts.identity ?? "unknown", history: opts.history });

  const final = await new Anthropic().beta.messages.toolRunner({
    model: AI_MODEL,
    max_tokens: spoken ? 1200 : 2000,
    max_iterations: 10, // enough for "count limes, onions and bones, then draft an order"
    thread: false,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: (spoken ? SPOKEN_PROMPT : TYPED_PROMPT) + historyNote(ctx.history),
    messages,
    tools: buildTools(ctx),
  });
  if (final.stop_reason === "refusal") throw new Error("The assistant declined to answer that.");
  const answer = final.content.filter((block) => block.type === "text").map((block) => block.text).join("\n\n").trim();
  if (!answer) throw new Error("The assistant didn't come up with an answer. Try again.");
  return { answer, order: ctx.order, changes: ctx.changes, links: ctx.links };
}
