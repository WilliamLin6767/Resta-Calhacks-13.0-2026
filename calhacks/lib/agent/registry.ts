// The one set of tools both Claude agents use: the owner chat (lib/voice/reply.ts, typed and
// voice) and the analytics assistant panel (app/api/assistant/route.ts, which adds its chart tools).
//
// Every write calls the same lib/ service as its API route, then signals live updates the way
// that route does. Names, units and odd counts are checked in code (lib/agent/resolve.ts): a tool
// asks instead of guessing. Every change is collected in ctx.changes, so an answer can only report
// what a tool really did. A failing tool returns "Error: ..." and never throws.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountingTools } from "./tools/accounting";
import { analyticsTools } from "./tools/analytics";
import { attentionTools } from "./tools/attention";
import { callTools } from "./tools/calls";
import { inventoryTools } from "./tools/inventory";
import { invoiceTools } from "./tools/invoices";
import { menuTools } from "./tools/menu";
import { navigationTools } from "./tools/navigation";
import { prepTools } from "./tools/prep";
import { purchasingTools } from "./tools/purchasing";
import { salesTools } from "./tools/sales";
import { supplierTools } from "./tools/suppliers";
import { errorText, type AgentCtx, type AgentTool, type Change } from "./types";

export const AGENT_TOOLS: AgentTool[] = [
  ...analyticsTools,
  ...inventoryTools,
  ...prepTools,
  ...invoiceTools,
  ...purchasingTools,
  ...supplierTools,
  ...callTools,
  ...menuTools,
  ...salesTools,
  ...attentionTools,
  ...accountingTools,
  ...navigationTools,
] as AgentTool[];

export function createCtx(input: { db: SupabaseClient; kind: AgentCtx["kind"]; identity: string; spoken?: boolean; days?: number; history?: Change[]; digest?: AgentCtx["digest"] }): AgentCtx {
  return {
    db: input.db,
    kind: input.kind,
    identity: input.identity,
    spoken: input.spoken ?? false,
    days: input.days ?? 30,
    digest: input.digest ?? null,
    history: input.history ?? [],
    changes: [],
    links: [],
    order: null,
  };
}

// The tools for one answer, bound to its context.
export function buildTools(ctx: AgentCtx) {
  return AGENT_TOOLS.map((tool) =>
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
