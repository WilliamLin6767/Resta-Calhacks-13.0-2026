import { loadPicture } from "@/lib/intelligence/load";
import { getSupabase } from "@/lib/supabase";

// GET /api/intelligence?refresh=1   the operating picture: the same one the agent's prompt and its
// get_operating_picture tool read. refresh rebuilds it instead of using the last few minutes' copy.
export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    return Response.json(await loadPicture(await getSupabase(), { fresh }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not build the operating picture." }, { status: 500 });
  }
}
