// What every agent tool shares (lib/agent/registry.ts builds the tool list from these).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Digest } from "@/lib/analytics";
import type { AssistantChart } from "@/lib/assistant";
import type { DraftRestock } from "@/lib/purchasing/restock";

// How to reverse a change, when it can be. undo_change only accepts a payload that came back in
// this conversation's changes, so the agent can't make one up.
export type UndoPayload =
  | { kind: "stock_count"; ingredient_id: number; qty: number; name: string; unit: string } // set the count back to qty
  | { kind: "waste"; ingredient_id: number; qty: number; name: string; unit: string }; // stock back to qty

// One thing a tool changed. label is what the owner reads: "Limes: 8 lb to 12 lb".
export type Change = {
  kind: string;
  label: string;
  before: string | number | null;
  after: string | number | null;
  undo?: UndoPayload;
};

// A page the chat shows as a link ("Open Invoices to scan it").
export type AgentLink = { href: string; label: string; reason: string };

export type DraftedOrder = Extract<DraftRestock, { drafted: true }>;

// Where the agent is answering: the owner chat (typed or spoken), the analytics panel, or the
// autonomous loop (Phase 5), which only gets read and draft tools.
export const SURFACES = ["chat", "voice", "panel", "loop"] as const;
export type Surface = (typeof SURFACES)[number];

// What a tool may do:
//   read    looks things up
//   draft   makes something that waits for the owner (a draft order, a pending call request)
//   record  changes an internal record right away, logged, with undo where possible
//   commit  spends money, changes prices, contacts someone outside or moves money: only ever a
//           proposal the owner approves on a card (Phase 3)
export const TIERS = ["read", "draft", "record", "commit"] as const;
export type Tier = (typeof TIERS)[number];

export type Area =
  | "inventory" | "prep" | "invoices" | "purchasing" | "suppliers" | "calls"
  | "menu" | "sales" | "marketing" | "findings" | "analytics" | "navigation";

// A Commit action waiting for the owner's tap (filled in by Phase 3's approval gate).
export type Proposal = { action_id: number; tool: string; title: string; summary: string };

export type AgentCtx = {
  db: SupabaseClient;
  surface: Surface;
  spoken: boolean; // voice: counts and waste are saved with source "voice"
  identity: string; // who's asking, for the AI routes' rate limits (the visitor's address)
  days: number; // the analytics period the agent is looking at
  digest: Digest | null; // that period's analytics, when already loaded
  history: Change[]; // changes returned earlier in this conversation (sent back by the client)
  changes: Change[]; // collected: every change a tool made in this answer
  links: AgentLink[]; // collected: pages to show as links
  charts: AssistantChart[]; // collected: charts the panel shows (show_chart)
  proposals: Proposal[]; // collected: Commit actions waiting for approval
  order: DraftedOrder | null; // a purchase order draft_restock made, for the chat's Approve button
  loop?: LoopCtx; // the loop surface: the case being investigated (lib/loop/engine.ts)
};

// What the loop's agent ends with (submit_proposal): checked in code against the playbook.
export type Submission = { recommendation: string; why: string; action_tools: string[]; args: Record<string, Record<string, unknown>> };
export type LoopCtx = {
  caseId: number;
  playbook: string;
  allowed: string[];
  submission: Submission | null;
  // The case's own dollars and evidence, shown on a proposal that has none of its own
  impact?: { amount_usd: number | null; per: "week" | "once"; basis: string } | null;
  evidence?: { label: string; value: string; href?: string }[];
  // Checks a Commit tool's arguments at submit time: why they're wrong, or null
  checkArgs?: (tool: string, args: Record<string, unknown>) => string | null;
};

export type AgentTool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  tier: Tier;
  area: Area;
  surfaces?: Surface[]; // only on these surfaces (default: all that its tier allows)
  input: S;
  run: (input: z.infer<S>, ctx: AgentCtx) => Promise<string>;
};

// Keeps the schema's type for run's input.
export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool<S> {
  return tool;
}

// ---------- What tools send back to Claude ----------

export const json = (value: unknown) => JSON.stringify(value);

// A question for the owner instead of a guess. Nothing was written.
export const ask = (question: string) => json({ ok: false, ask: question });

// A write that worked: collected into ctx.changes, so the answer can only report real changes.
export function changed(ctx: AgentCtx, change: Change, extra: Record<string, unknown> = {}) {
  ctx.changes.push(change);
  return json({ ok: true, change, ...extra });
}

export const errorText = (err: unknown) => `Error: ${err instanceof Error ? err.message : String(err)}`;

// Lists stay short: about 30 rows, and say how many more there are.
export const MAX_ROWS = 30;
export function capped<T>(rows: T[], max = MAX_ROWS) {
  return rows.length > max ? { rows: rows.slice(0, max), more: rows.length - max } : { rows };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
