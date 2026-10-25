// Payout claims: when a delivery app paid short, didn't pay, or its money didn't reach the bank,
// the app drafts the email to the app's support. The owner reviews it, then approves (it's sent from
// the restaurant's Gmail) or rejects it. Each send or rejection is a row in the action log
// (agent_actions, tool send_payout_claim), so the page shows what already happened.
import type { SupabaseClient } from "@supabase/supabase-js";
import { RESTAURANT_ID } from "@/lib/supabase";
import { payoutDispute, PLATFORMS, type PayoutCheck, type Platform } from "./reconcile";

export type ClaimDraft = { key: string; platform: Platform; to: string; subject: string; body: string; title: string };
export type ClaimState = { status: "sent" | "opened" | "rejected" | "failed"; to: string; at: string; error?: string };

// Who gets it: set per app (PAYOUT_SUPPORT_EMAIL_DOORDASH, PAYOUT_SUPPORT_EMAIL_UBEREATS), else the owner types it
export function supportEmail(platform: Platform, env: Record<string, string | undefined> = process.env) {
  return env[`PAYOUT_SUPPORT_EMAIL_${platform.toUpperCase()}`] ?? "";
}

function week(c: { period_start: string; period_end: string }) {
  return `${c.period_start} to ${c.period_end}`;
}

// The app paid less than our orders say, or didn't pay at all
export function payoutClaim(c: PayoutCheck, restaurant: string): ClaimDraft {
  const app = PLATFORMS[c.platform];
  const ref = c.payout?.reference ? ` (${c.payout.reference})` : "";
  return {
    key: `payout:${c.platform}:${c.period_start}`, platform: c.platform, to: supportEmail(c.platform),
    subject: c.status === "missing" ? `Missing ${app} payout, week of ${week(c)}` : `${app} payout short, week of ${week(c)}${ref}`,
    body: payoutDispute(c, restaurant),
    title: `Email ${app} about the week of ${c.period_start}`,
  };
}

// The app's statement says it paid, but the bank got less or nothing (the note is lib/bank/match.ts)
export function bankClaim(c: { week: PayoutCheck; status: string }, note: string): ClaimDraft {
  const w = c.week;
  const app = PLATFORMS[w.platform];
  const ref = w.payout?.reference ? ` (${w.payout.reference})` : "";
  return {
    key: `bank:${w.platform}:${w.period_start}`, platform: w.platform, to: supportEmail(w.platform),
    subject: c.status === "no_deposit" ? `${app} payout never reached our bank, week of ${week(w)}${ref}` : `${app} payout short at our bank, week of ${week(w)}${ref}`,
    body: note,
    title: `Email ${app} about the deposit for the week of ${w.period_start}`,
  };
}

// The latest send or rejection for each claim. Empty if the action log isn't set up yet.
export async function claimStates(db: SupabaseClient, keys: string[]): Promise<Record<string, ClaimState>> {
  if (!keys.length) return {};
  const res = await db.from("agent_actions").select("status, args, result, error, created_at, done_at")
    .eq("restaurant_id", RESTAURANT_ID).eq("tool", "send_payout_claim").in("status", ["done", "rejected", "failed"])
    .order("created_at", { ascending: false }).limit(200);
  if (res.error) return {};
  const out: Record<string, ClaimState> = {};
  type Row = { status: string; args: Record<string, unknown>; result: Record<string, unknown> | null; error: string | null; created_at: string; done_at: string | null };
  for (const r of (res.data ?? []) as Row[]) {
    const key = typeof r.args?.claim_key === "string" ? r.args.claim_key : "";
    if (!keys.includes(key) || out[key]) continue;
    const to = typeof r.args?.to === "string" ? r.args.to : "";
    const at = r.done_at ?? r.created_at;
    if (r.status === "rejected") out[key] = { status: "rejected", to, at };
    else if (r.status === "failed") out[key] = { status: "failed", to, at, error: r.error ?? undefined };
    else out[key] = { status: r.result?.sent ? "sent" : "opened", to, at };
  }
  return out;
}
