// What every agent tool shares (lib/agent/registry.ts builds the tool list from these).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Digest } from "@/lib/analytics";
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

export type AgentCtx = {
  db: SupabaseClient;
  kind: "chat" | "panel"; // the owner chat (typed or voice) or the analytics assistant panel
  spoken: boolean; // voice: counts and waste are saved with source "voice"
  identity: string; // who's asking, for the AI routes' rate limits (the visitor's address)
  days: number; // the analytics period the agent is looking at
  digest: Digest | null; // that period's analytics, when already loaded
  history: Change[]; // changes returned earlier in this conversation (sent back by the client)
  changes: Change[]; // collected: every change a tool made in this answer
  links: AgentLink[]; // collected: pages to show as links
  order: DraftedOrder | null; // a purchase order draft_restock made, for the chat's Approve button
};

export type AgentTool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
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
