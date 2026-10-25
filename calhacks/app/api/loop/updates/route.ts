import { listCases, CasesTableMissing } from "@/lib/loop/store";
import { getSupabase } from "@/lib/supabase";

// GET /api/loop/updates?since=2026-10-24T10:00:00Z
// Cases that reached "proposed" or "closed" since then, as the one message the chat posts for
// each: "I noticed ...; I propose ..." with the action cards, or "Results for ...: ...".
export async function GET(request: Request) {
  const since = new URL(request.url).searchParams.get("since");
  const sinceMs = since && !Number.isNaN(Date.parse(since)) ? Date.parse(since) : Date.now() - 24 * 3600_000;
  try {
    const cases = await listCases(await getSupabase(), { statuses: ["proposed", "closed"], limit: 20 });
    const updates = cases
      .filter((c) => Date.parse(c.updated_at) > sinceMs)
      .reverse()
      .map((c) => {
        const title = String(c.facts.title ?? c.playbook);
        if (c.status === "closed") {
          return { case_id: c.id, at: c.updated_at, is_demo: c.is_demo, text: `Results for ${title.charAt(0).toLowerCase()}${title.slice(1)}: ${c.report ?? "measured."}`, action_ids: [] as number[] };
        }
        const p = c.proposal;
        return {
          case_id: c.id,
          at: c.updated_at,
          is_demo: c.is_demo,
          text: `I noticed ${title.charAt(0).toLowerCase()}${title.slice(1)}. I propose: ${p?.recommendation ?? "a look at it"}${p?.why ? ` ${p.why}` : ""}`,
          action_ids: p?.action_ids ?? [],
        };
      });
    return Response.json({ updates, now: new Date().toISOString() });
  } catch (err) {
    if (err instanceof CasesTableMissing) return Response.json({ updates: [], now: new Date().toISOString(), setup: err.message });
    return Response.json({ error: err instanceof Error ? err.message : "Could not load the loop's updates." }, { status: 500 });
  }
}
