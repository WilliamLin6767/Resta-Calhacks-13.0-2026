// The one set of tools behind the one agent (lib/agent/run.ts): the owner chat (typed and voice),
// the analytics panel, and the autonomous loop.
//
// Every tool has a tier (read, draft, record, commit) and an area. The loop only gets read and
// draft tools. Every write calls the same lib/ service as its API route, then signals live updates
// the way that route does. Names, units and odd counts are checked in code (lib/agent/resolve.ts):
// a tool asks instead of guessing. Every change is collected in ctx.changes, so an answer can only
// report what a tool really did. A failing tool returns "Error: ..." and never throws.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analyticsTools } from "./tools/analytics";
import { callTools } from "./tools/calls";
import { loopTools } from "./tools/loop";
import { commitTools } from "./tools/commit";
import { findingTools } from "./tools/findings";
import { intelligenceTools } from "./tools/intelligence";
import { inventoryTools } from "./tools/inventory";
import { invoiceTools } from "./tools/invoices";
import { marketingTools } from "./tools/marketing";
import { menuTools } from "./tools/menu";
import { navigationTools } from "./tools/navigation";
import { prepTools } from "./tools/prep";
import { purchasingTools } from "./tools/purchasing";
import { salesTools } from "./tools/sales";
import { supplierTools } from "./tools/suppliers";
import { errorText, type AgentCtx, type AgentTool, type Change, type Surface, type Tier } from "./types";

export const AGENT_TOOLS: AgentTool[] = [
  ...analyticsTools,
  ...findingTools,
  ...intelligenceTools, // the operating picture (layer 2) and past outcomes (layer 3)
  ...inventoryTools,
  ...prepTools,
  ...invoiceTools,
  ...purchasingTools,
  ...supplierTools,
  ...callTools,
  ...menuTools,
  ...salesTools,
  ...marketingTools,
  ...navigationTools,
  ...commitTools, // proposals only: the owner approves each on a card
  ...loopTools, // the loop surface only
] as AgentTool[];

// Which tiers each surface may use. The loop can look things up and draft, never record or commit.
const SURFACE_TIERS: Record<Surface, Tier[]> = {
  chat: ["read", "draft", "record", "commit"],
  voice: ["read", "draft", "record", "commit"],
  panel: ["read", "draft", "record", "commit"],
  loop: ["read", "draft"],
};

export function toolsFor(surface: Surface): AgentTool[] {
  return AGENT_TOOLS.filter((t) => SURFACE_TIERS[surface].includes(t.tier) && (!t.surfaces || t.surfaces.includes(surface)));
}

export function createCtx(input: { db: SupabaseClient; surface: Surface; identity: string; days?: number; history?: Change[]; digest?: AgentCtx["digest"]; loop?: AgentCtx["loop"]; discovery?: string }): AgentCtx {
  return {
    db: input.db,
    surface: input.surface,
    spoken: input.surface === "voice",
    identity: input.identity,
    days: input.days ?? 30,
    digest: input.digest ?? null,
    history: input.history ?? [],
    changes: [],
    links: [],
    charts: [],
    proposals: [],
    order: null,
    loop: input.loop,
    discovery: input.discovery,
  };
}

// The tools for one answer, bound to its context. only: just these names (the loop's playbook).
export function buildTools(ctx: AgentCtx, only?: string[]) {
  return toolsFor(ctx.surface)
    .filter((tool) => !only || only.includes(tool.name))
    .map((tool) =>
    betaZodTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input,
      run: async (input) => {
        try {
          return await tool.run(input, ctx);
        } catch (err) {
          return errorText(err);
        }
      },
    }),
  );
}
