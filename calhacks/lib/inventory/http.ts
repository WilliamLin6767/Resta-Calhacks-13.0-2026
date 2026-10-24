import { clientIp, createRateLimiter } from "@/lib/aiLimits";
import { errorResponse } from "@/lib/purchasing/http";
import { toUnits } from "./stock";
import type { IngredientRef, ProposedCount } from "./ai";

// AI calls cost money: shared limits for the photo and note readers
const perVisitorLimit = createRateLimiter({ limit: 15, windowMs: 10 * 60 * 1000 });
const dailyLimit = createRateLimiter({ limit: 150, windowMs: 24 * 60 * 60 * 1000 });

export function aiLimited(request: Request): Response | null {
  for (const result of [perVisitorLimit(clientIp(request)), dailyLimit("all")]) {
    if (!result.ok) return errorResponse(`Too many AI requests. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} minutes.`, 429);
  }
  return null;
}

// What the screen shows for one proposed line: always in the ingredient's own unit
export type Proposal = { ingredient_id: number; name: string; unit: string; qty: number; confidence: number; seen: string; note: string };

export function toProposal(p: Pick<ProposedCount, "ingredient_id" | "name_seen" | "qty" | "in_packs" | "note"> & { confidence?: number },
  refs: IngredientRef[], packQty: Record<number, number>): Proposal {
  const ref = refs.find((r) => r.id === p.ingredient_id);
  return {
    ingredient_id: ref ? ref.id : 0,
    name: ref?.name ?? p.name_seen,
    unit: ref?.unit ?? "",
    qty: toUnits(p.qty, p.in_packs, packQty[p.ingredient_id] ?? null),
    confidence: Math.max(0, Math.min(1, p.confidence ?? 1)),
    seen: p.in_packs ? `${p.qty} ${p.qty === 1 ? "pack" : "packs"}` : "",
    note: p.note,
  };
}

// [{ ingredient_id, qty, ... }] from a request body, keeping only well-formed rows
export function parseItems(value: unknown): { ingredient_id: number; qty: number; reason: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v && Number.isInteger(Number(v.ingredient_id)) && Number(v.ingredient_id) > 0 && Number.isFinite(Number(v.qty)))
    .slice(0, 100)
    .map((v) => ({ ingredient_id: Number(v.ingredient_id), qty: Number(v.qty), reason: typeof v.reason === "string" ? v.reason : "other" }));
}
