// One Claude turn for the owner chat. Typed and spoken messages share these tools.
// The order, if any, stays a draft. This never approves or sends it.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { loadAnalytics } from "@/app/analytics/data";
import { checkIngredient, draftRestock, type DraftRestock } from "@/lib/purchasing/restock";
import { getSupabase } from "@/lib/supabase";

const AI_MODEL = "claude-sonnet-5-5";

const RULES = [
  "Use the conversation so far.",
  "Use check_ingredient when they mention a food. Use draft_restock when they want it restocked.",
  "Get every number from your tools. Never invent a number.",
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

export type DraftedOrder = Extract<DraftRestock, { drafted: true }>;

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

export async function replyToOwner(messages: Turn[], spoken: boolean): Promise<{ answer: string; order: DraftedOrder | null }> {
  const loaded = await loadAnalytics(30);
  const digest = "error" in loaded ? null : loaded.digest;
  let drafted: DraftedOrder | null = null;

  const tools = [
    betaZodTool({
      name: "get_dashboard_summary",
      description: "The restaurant's last 30 days: sales, costs, menu, and supplier price changes. No stock quantities.",
      inputSchema: z.object({}),
      run: async () => (digest ? JSON.stringify({ restaurant: digest.restaurant, period: digest.period, kpis: digest.kpis, costs: digest.costs, price_changes: digest.price_changes }) : "Error: the dashboard summary is unavailable."),
    }),
    betaZodTool({
      name: "check_ingredient",
      description: "Stock on hand, par, and the suppliers who sell one ingredient. Pass the food name the owner said.",
      inputSchema: z.object({ ingredient: z.string() }),
      run: async ({ ingredient }) => JSON.stringify(await checkIngredient(await getSupabase(), ingredient)),
    }),
    betaZodTool({
      name: "draft_restock",
      description: "Draft one purchase order for a low ingredient. Does not approve or send it. Pass the food name the owner said.",
      inputSchema: z.object({ ingredient: z.string() }),
      run: async ({ ingredient }) => {
        const result = await draftRestock(await getSupabase(), ingredient);
        if (result.drafted) drafted = result;
        return JSON.stringify(result);
      },
    }),
  ];

  const final = await new Anthropic().beta.messages.toolRunner({
    model: AI_MODEL,
    max_tokens: spoken ? 1200 : 2000,
    max_iterations: 6,
    thread: false,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: spoken ? SPOKEN_PROMPT : TYPED_PROMPT,
    messages,
    tools,
  });
  if (final.stop_reason === "refusal") throw new Error("The assistant declined to answer that.");
  const answer = final.content.filter((block) => block.type === "text").map((block) => block.text).join("\n\n").trim();
  if (!answer) throw new Error("The assistant didn't come up with an answer. Try again.");
  return { answer, order: drafted };
}
