import { errorResponse, handleCallError } from "@/lib/calls/http";
import { listCalls } from "@/lib/calls/service";
import { CONTEXT_TYPES, type ContextType } from "@/lib/calls/types";
import { getSupabase } from "@/lib/supabase";

// GET /api/calls?context_type=invoice&context_id=12   requests shown on one record
// GET /api/calls?supplier_id=3                         every request for one supplier
// GET /api/calls                                       the latest requests, any record
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get("context_type");
  if (type !== null && !(CONTEXT_TYPES as readonly string[]).includes(type)) return errorResponse("Unknown context_type.", 400);
  const toId = (v: string | null) => (v === null ? undefined : Number(v));
  const contextId = toId(params.get("context_id"));
  const supplierId = toId(params.get("supplier_id"));
  if ([contextId, supplierId].some((n) => n !== undefined && !(Number.isInteger(n) && n > 0))) return errorResponse("Ids must be positive whole numbers.", 400);

  try {
    const calls = await listCalls(await getSupabase(), {
      context_type: (type ?? undefined) as ContextType | undefined,
      context_id: contextId,
      supplier_id: supplierId,
    });
    return Response.json({ calls });
  } catch (err) {
    return handleCallError(err);
  }
}
