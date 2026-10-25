// Reversing a change from this conversation (undo_change, and POST /api/agent/undo for the chat's
// Undo button). Only stock counts and waste can be undone: both set the stock back to what it
// was, through the same service as a count. A payload that didn't come back in this
// conversation's changes is refused, so nothing can be "undone" into a made-up value.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { saveCounts } from "@/lib/inventory/service";
import { signalAfter } from "@/lib/live/signal";
import type { Change, UndoPayload } from "./types";

export const UndoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stock_count"), ingredient_id: z.number().int().positive(), qty: z.number().min(0), name: z.string().max(200), unit: z.string().max(40) }),
  z.object({ kind: z.literal("waste"), ingredient_id: z.number().int().positive(), qty: z.number().min(0), name: z.string().max(200), unit: z.string().max(40) }),
]);

export const ChangeSchema = z.object({
  kind: z.string().max(60),
  label: z.string().max(500),
  before: z.union([z.string(), z.number(), z.null()]),
  after: z.union([z.string(), z.number(), z.null()]),
  undo: UndoSchema.optional(),
});

// The changes the client sent back with the conversation, or [] if they aren't valid.
export function parseHistory(input: unknown): Change[] {
  const parsed = z.array(ChangeSchema).max(50).safeParse(Array.isArray(input) ? input.slice(-50) : []);
  return parsed.success ? parsed.data : [];
}

const key = (u: UndoPayload) => JSON.stringify([u.kind, u.ingredient_id, u.qty, u.name, u.unit]);

export function inHistory(undo: UndoPayload, history: Change[]) {
  return history.some((c) => c.undo && key(c.undo) === key(undo));
}

export type Undone = { ok: true; change: Change } | { ok: false; error: string };

export async function undoChange(db: SupabaseClient, undo: UndoPayload, history: Change[], source: "voice" | "manual"): Promise<Undone> {
  if (!inHistory(undo, history)) return { ok: false, error: "That change isn't one from this conversation, so I can't undo it." };
  await saveCounts(db, [{ ingredient_id: undo.ingredient_id, qty: undo.qty }], source);
  signalAfter(undo.kind === "waste" ? "/api/inventory/waste" : "/api/inventory/counts");
  return {
    ok: true,
    change: { kind: "undo", label: `Undone: ${undo.name} back to ${undo.qty} ${undo.unit}`, before: null, after: undo.qty },
  };
}
