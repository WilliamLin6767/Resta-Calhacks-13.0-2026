// The "Needs you" bar on top of Supabase (server only).
//   loadBar   - a tab's items (minus dismissed ones) and its saved AI summary, if it's still current
//   writeSummary - writes and saves a new AI summary when the tab's numbers changed
//   dismiss   - hide an alert until it changes
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRateLimiter } from "@/lib/aiLimits";
import { RESTAURANT_ID } from "@/lib/supabase";
import { SUMMARY_VERSION, summarizeTab, TabSummarySchema, type TabSummary } from "./ai";
import { buildTab } from "./build";
import type { Item, Tab, TabFacts } from "./types";

type Db = SupabaseClient;

// Summaries are only rewritten when a tab's numbers change, so this is a backstop
const dailyLimit = createRateLimiter({ limit: 200, windowMs: 24 * 60 * 60 * 1000 });

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

export function factsHash(facts: TabFacts) {
  return createHash("sha256").update(`v${SUMMARY_VERSION}:${JSON.stringify(facts)}`).digest("hex").slice(0, 32);
}

async function dismissed(db: Db) {
  const rows = must(
    await db.from("attention_dismissals").select("item_key, fingerprint").eq("restaurant_id", RESTAURANT_ID),
    "load dismissed alerts (has supabase/11_attention.sql been run?)",
  ) as { item_key: string; fingerprint: string }[];
  return new Set(rows.map((r) => `${r.item_key}|${r.fingerprint}`));
}

export async function loadBar(db: Db, tab: Tab): Promise<{ items: Item[]; facts: TabFacts; hash: string; summary: TabSummary | null; summaryAt: string | null }> {
  const [{ items, facts }, hidden] = await Promise.all([buildTab(db, tab), dismissed(db)]);
  const hash = factsHash(facts);
  const saved = must(
    await db.from("ai_tab_summaries").select("summary, created_at").eq("restaurant_id", RESTAURANT_ID).eq("tab", tab).eq("facts_hash", hash)
      .order("created_at", { ascending: false }).limit(1),
    "load the saved summary",
  ) as { summary: unknown; created_at: string }[];
  const parsed = TabSummarySchema.safeParse(saved[0]?.summary);
  const order = { act: 0, watch: 1, info: 2 };
  return {
    items: items.filter((i) => !hidden.has(`${i.key}|${i.fingerprint}`)).sort((a, b) => order[a.level] - order[b.level]),
    facts, hash,
    summary: parsed.success ? parsed.data : null,
    summaryAt: parsed.success ? saved[0].created_at : null,
  };
}

export async function writeSummary(db: Db, facts: TabFacts, hash: string): Promise<TabSummary> {
  if (!dailyLimit("all").ok) throw new Error("Too many AI summaries today.");
  const summary = await summarizeTab(facts);
  must(await db.from("ai_tab_summaries").insert({ restaurant_id: RESTAURANT_ID, tab: facts.tab, facts_hash: hash, summary }), "save the summary");
  return summary;
}

export async function dismiss(db: Db, key: string, fingerprint: string) {
  must(
    await db.from("attention_dismissals").upsert(
      { restaurant_id: RESTAURANT_ID, item_key: key.slice(0, 200), fingerprint: fingerprint.slice(0, 500) },
      { onConflict: "restaurant_id,item_key,fingerprint", ignoreDuplicates: true },
    ),
    "dismiss it",
  );
}
