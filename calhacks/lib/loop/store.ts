// The loop's cases on Supabase (supabase/19_cases.sql), server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { RESTAURANT_ID } from "@/lib/supabase";
import type { CaseStore } from "./engine";
import { OPEN_CASE_STATUSES, type CaseRow, type Lesson } from "./types";

export class CasesTableMissing extends Error {}

const missing = (m: string) => /relation "cases"|cases.*does not exist|schema cache/i.test(m);

export function supabaseCases(db: SupabaseClient): CaseStore {
  const table = () => db.from("cases");
  const fail = (what: string, m: string): never => {
    if (missing(m)) throw new CasesTableMissing(`The loop isn't set up: run supabase/19_cases.sql. (${m})`);
    throw new Error(`Could not ${what}: ${m}`);
  };
  return {
    async insert(c) {
      const res = await table().insert({ restaurant_id: RESTAURANT_ID, ...c }).select("*").single();
      if (res.error) {
        if (res.error.code === "23505") return null; // the finding already has an open case
        fail("open a case", res.error.message);
      }
      return res.data as CaseRow;
    },
    async inCooldown(findingKey, sinceIso) {
      const res = await table().select("id").eq("restaurant_id", RESTAURANT_ID).eq("finding_key", findingKey).in("status", ["closed", "dismissed", "failed"]).gte("updated_at", sinceIso).limit(1);
      if (res.error) fail("check the cooldown", res.error.message);
      return (res.data ?? []).length > 0;
    },
    async openCount(playbook) {
      const res = await table().select("id", { count: "exact", head: true }).eq("restaurant_id", RESTAURANT_ID).eq("playbook", playbook).in("status", OPEN_CASE_STATUSES);
      if (res.error) fail("count open cases", res.error.message);
      return res.count ?? 0;
    },
    async claim(id, from, patch) {
      const res = await table().update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("restaurant_id", RESTAURANT_ID).in("status", from).select("*").maybeSingle();
      if (res.error) fail("update the case", res.error.message);
      return (res.data as CaseRow | null) ?? null;
    },
    async list(statuses, limit) {
      const res = await table().select("*").eq("restaurant_id", RESTAURANT_ID).in("status", statuses).order("created_at", { ascending: true }).limit(limit);
      if (res.error) fail("load cases", res.error.message);
      return (res.data ?? []) as CaseRow[];
    },
    async lessons(playbook, n) {
      const res = await table().select("lesson").eq("restaurant_id", RESTAURANT_ID).eq("playbook", playbook).eq("status", "closed").not("lesson", "is", null).order("closed_at", { ascending: false }).limit(n);
      if (res.error) fail("load lessons", res.error.message);
      return ((res.data ?? []) as { lesson: Lesson }[]).map((r) => r.lesson);
    },
    async actionsFor(caseId) {
      const res = await db.from("agent_actions").select("id, tool, status").eq("restaurant_id", RESTAURANT_ID).eq("case_id", caseId);
      if (res.error) return []; // no action log yet: nothing approved
      return (res.data ?? []) as { id: number; tool: string; status: string }[];
    },
  };
}

// Cases for the Actions page and the Today card, newest first.
export async function listCases(db: SupabaseClient, opts: { statuses?: string[]; limit?: number } = {}): Promise<CaseRow[]> {
  let q = db.from("cases").select("*").eq("restaurant_id", RESTAURANT_ID).order("updated_at", { ascending: false }).limit(opts.limit ?? 50);
  if (opts.statuses?.length) q = q.in("status", opts.statuses);
  const res = await q;
  if (res.error) {
    if (missing(res.error.message)) throw new CasesTableMissing("The loop isn't set up: run supabase/19_cases.sql.");
    throw new Error(`Could not load cases: ${res.error.message}`);
  }
  return (res.data ?? []) as CaseRow[];
}

// The last lessons for a playbook, for the ranking tools. Empty without the table.
export async function recentLessons(db: SupabaseClient, playbook: string, n = 5): Promise<Lesson[]> {
  const res = await db.from("cases").select("lesson").eq("restaurant_id", RESTAURANT_ID).eq("playbook", playbook).eq("status", "closed").not("lesson", "is", null).order("closed_at", { ascending: false }).limit(n);
  return res.error ? [] : ((res.data ?? []) as { lesson: Lesson }[]).map((r) => r.lesson);
}
