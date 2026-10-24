import { z } from "zod";
import { aiRateLimit, errorResponse, handleCallError } from "@/lib/calls/http";
import { createOwnerRequest } from "@/lib/calls/service";
import { CONTEXT_TYPES } from "@/lib/calls/types";
import { getSupabase } from "@/lib/supabase";
import { syncCallsAfter } from "@/lib/live/signal";

const BodySchema = z.object({
  supplier_id: z.number().int().positive(),
  text: z.string().trim().min(3).max(1000),
  context_type: z.enum(CONTEXT_TYPES).optional(),
  context_id: z.number().int().positive().optional(),
});

// POST /api/calls/request   { supplier_id, text: "ask if they can deliver extra brisket Saturday" }
// Claude turns the owner's words into a brief; the request still waits for approval. Returns { id, title }.
export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("Pick a supplier and say what to ask (3 to 1000 characters).", 400);
  const limited = aiRateLimit(request);
  if (limited) return limited;
  try {
    const db = await getSupabase();
    const made = await createOwnerRequest(db, parsed.data, "owner");
    syncCallsAfter(db, [made.id], "/api/calls/request");
    return Response.json(made);
  } catch (err) {
    return handleCallError(err);
  }
}
