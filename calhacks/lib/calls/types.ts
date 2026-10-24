// Shapes shared by the calls feature: what's stored in call_requests
// (supabase/13_calls.sql), the brief the caller is given, and the result.

import { z } from "zod";
import type { DialTarget } from "./phone";

export const CONTEXT_TYPES = ["invoice", "supplier", "ingredient", "purchase_order"] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

export const CALL_PURPOSES = ["buy", "dispute", "info", "special_request"] as const;
export type CallPurpose = (typeof CALL_PURPOSES)[number];

export const CALL_STATUSES = ["pending", "approved", "rejected", "calling", "needs_input", "completed", "failed"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

// Requests in these states block a new request on the same record.
export const OPEN_STATUSES: CallStatus[] = ["pending", "approved", "calling", "needs_input"];
// A call is under way: Wajo is working on it.
export const ACTIVE_STATUSES: CallStatus[] = ["calling", "needs_input"];
// Only one call at a time: these block approving another. "approved" counts too, since
// starting a call with Wajo can take a while and a second approval could slip in.
export const BUSY_STATUSES: CallStatus[] = ["approved", "calling", "needs_input"];

// What the caller is told. Written by Claude, editable by the owner before approval.
// Money and pack limits are set by our code from the data (Claude can't loosen them);
// 0 means "not applicable".
export const BriefSchema = z.object({
  goal: z.string().min(1).max(500), // one sentence
  ask_for: z.string().max(100), // who to ask for; empty = default for the purpose
  facts: z.array(z.string().max(500)).max(20),
  questions: z.array(z.string().max(300)).max(10),
  wanted_by: z.string().max(40), // delivery date for orders, or ""
  limits: z.object({
    min_credit: z.number().min(0), // disputes: accept a credit or corrected invoice of at least this
    max_packs: z.number().min(0), // orders: at most this many packs
    max_total: z.number().min(0), // orders: at most this many dollars
    notes: z.string().max(500), // anything else it may or may not agree to
  }),
});
export type Brief = z.infer<typeof BriefSchema>;

// Ids of the records a request is about, so suggested actions can act on them.
export type BriefRefs = {
  invoice_id?: number;
  flag_ids?: number[];
  ingredient_id?: number;
  ingredient_ids?: number[];
  purchase_order_id?: number;
};

// What's stored in call_requests.brief.
export type StoredBrief = Brief & { refs: BriefRefs };

// What Claude reads out of a finished call (Step 6).
export const CALL_OUTCOMES = ["resolved", "partial", "refused", "no_answer", "callback_needed"] as const;
export const CallResultSchema = z.object({
  reached_person: z.boolean(),
  outcome: z.enum(CALL_OUTCOMES),
  credit_amount: z.number().nullable(),
  new_price: z.number().nullable(), // per pack
  effective_date: z.string(), // YYYY-MM-DD or ""
  delivery_eta: z.string(), // YYYY-MM-DD or plain words, or ""
  order_confirmed: z.boolean(),
  follow_up: z.string(),
  // The supplier can't reliably supply the item soon enough (shortage, out of stock, can't
  // deliver in time, a price rise with no short-term relief). Starts a supplier-switch check.
  supply_problem: z.boolean(),
  summary: z.string(), // two sentences, stored as call_requests.outcome
});
export type CallResult = z.infer<typeof CallResultSchema>;

// A question the caller asked mid-call, and what we answered.
export type CallQA = { question: string; answer: string; at: string };

// call_requests.result: the structured result once done. From approval on it also
// keeps where the call went (both numbers when the demo override is on), the
// caller's questions with our answers, and the suggested actions already done.
// While the call is still going, `waiting_on` is the caller's last "still on it" message
// (e.g. "the call is going out now, I'll report back") and `waiting_since` when it was first seen.
export type StoredResult = Partial<CallResult> & {
  dial?: DialTarget;
  qa?: CallQA[];
  applied?: string[];
  waiting_on?: string;
  waiting_since?: string;
  stage?: "summarizing"; // the call is over and Claude is reading what happened
  switch?: SwitchCheck; // after a supply problem: should the owner switch suppliers?
};

// ---------------------------------------------------------------------
// Supplier switch check (lib/calls/switching.ts), stored in result.switch
// ---------------------------------------------------------------------

// What a shortage puts at risk, worked out by code from the analytics digest and inventory.
export type SwitchImpact = {
  ingredient: string;
  unit: string;
  on_hand: number;
  daily_use: number;
  days_left: number | null;
  dishes: { name: string; units_30d: number; revenue_30d: number; gross_profit_30d: number | null; class: string }[];
  revenue_at_risk_30d: number; // sales of the dishes that use it, last 30 days
  share_of_revenue_pct: number | null;
  gross_profit_at_risk_30d: number | null;
  current_supplier: string;
  current_price: { per_pack: number; pack_desc: string | null; since: string; change_pct: number | null } | null;
  on_file_alternatives: { supplier: string; per_pack: number; pack_desc: string | null; unit_cost: number; current_unit_cost: number | null }[];
};

// A company the owner could switch to: a supplier already on file that sells the item, or an
// outside company from the Apify ThomasNet scrape (supplier_leads).
export type SwitchLead = {
  source: "on_file" | "thomasnet";
  supplier_id?: number; // on_file only
  company_name: string;
  phone: string;
  city: string | null;
  state: string | null;
  matched_product: string | null; // what it says it sells (ThomasNet), or its price on file
};

export type SwitchCheck = {
  status: "checking" | "done" | "error";
  checked_at: string;
  ingredient_id?: number;
  impact?: SwitchImpact;
  leads_considered?: number; // on-file suppliers plus ThomasNet leads
  no_leads_reason?: string; // why there was nobody to consider
  searched_apify?: boolean; // ran a new ThomasNet search because no leads were saved
  recommend?: boolean;
  verdict?: string; // two sentences for the owner
  pros?: string[];
  cons?: string[];
  lead?: SwitchLead; // the suggested new supplier
  follow_up_call_id?: number; // the pending call to that supplier
  error?: string;
};

const SWITCH_STALE_MS = 5 * 60 * 1000; // a "checking" this old was interrupted (e.g. a restart)

// The ingredient a call is about, when it's about exactly one.
export function callIngredient(row: Pick<CallRow, "brief">): number | undefined {
  const refs = row.brief.refs ?? {};
  return refs.ingredient_id ?? (refs.ingredient_ids?.length === 1 ? refs.ingredient_ids[0] : undefined);
}

// A finished call that found a supply problem with one ingredient and hasn't been weighed yet.
export function needsSwitchCheck(row: Pick<CallRow, "status" | "brief" | "result">, now = Date.now()): boolean {
  if (row.status !== "completed" || row.result?.supply_problem !== true || callIngredient(row) === undefined) return false;
  const check = row.result.switch;
  if (!check) return true;
  return check.status === "checking" && now - new Date(check.checked_at).getTime() > SWITCH_STALE_MS;
}

// The progress bar the owner sees after approving. The back-and-forth between our
// server, Claude and Wajo stays behind it.
export const CALL_STEPS = ["Starting the call", "On the phone", "Summarizing", "Done"] as const;

// Which of CALL_STEPS a request is on (0-3), or null when there's no progress to show
// (pending, rejected, failed).
export function callStep(row: Pick<CallRow, "status" | "result">): number | null {
  if (row.status === "approved") return 0;
  if (row.status === "calling" || row.status === "needs_input") return row.result?.stage === "summarizing" ? 2 : 1;
  if (row.status === "completed") return 3;
  return null;
}

export type CallRow = {
  id: number;
  restaurant_id: number;
  supplier_id: number;
  context_type: ContextType;
  context_id: number;
  purpose: CallPurpose;
  title: string;
  reason: string;
  brief: StoredBrief;
  status: CallStatus;
  proposed_by: "ai" | "owner";
  wajo_call_id: string | null;
  dialed_number: string | null;
  progress: string | null;
  question: string | null;
  last_polled_at: string | null;
  outcome: string | null;
  result: StoredResult | null;
  transcript: string | null;
  created_at: string;
  decided_at: string | null;
  completed_at: string | null;
  error: string | null;
};

// ---------------------------------------------------------------------
// After a call: buttons the owner can click. Nothing changes automatically.
// ---------------------------------------------------------------------

export type SuggestedAction =
  | { id: "resolve_flags"; label: string }
  | { id: "record_price"; label: string; price: number; effective_date: string }
  | { id: "mark_po_sent"; label: string };

export function suggestedActions(row: Pick<CallRow, "status" | "purpose" | "brief" | "result">): SuggestedAction[] {
  const r = row.result;
  if (row.status !== "completed" || !r || r.outcome === undefined) return [];
  const applied = new Set(r.applied ?? []);
  const refs = row.brief.refs ?? {};
  const actions: SuggestedAction[] = [];

  if (row.purpose === "dispute" && refs.flag_ids?.length && (r.outcome === "resolved" || (r.credit_amount ?? 0) > 0)) {
    actions.push({ id: "resolve_flags", label: "Mark flag resolved" });
  }
  const ingredient = refs.ingredient_id ?? (refs.ingredient_ids?.length === 1 ? refs.ingredient_ids[0] : undefined);
  if (r.new_price != null && r.new_price > 0 && ingredient !== undefined) {
    const from = r.effective_date || "today";
    actions.push({
      id: "record_price",
      label: `Record new price $${r.new_price.toFixed(2)} from ${from}`,
      price: r.new_price,
      effective_date: r.effective_date ?? "",
    });
  }
  if (row.purpose === "buy" && r.order_confirmed && refs.purchase_order_id !== undefined) {
    actions.push({ id: "mark_po_sent", label: "Mark PO sent" });
  }
  return actions.filter((a) => !applied.has(a.id));
}

// ---------------------------------------------------------------------
// Finished calls: their own list, most important first.
// ---------------------------------------------------------------------

export const FINISHED_STATUSES: CallStatus[] = ["completed", "failed"];
const RECENT_DAYS = 7; // finished longer ago than this sinks below every recent call

// 0 = a suggested action is waiting (e.g. "Record new price"), 1 = needs a follow-up
// (didn't go through, partly resolved, they'll call back...), 2 = nothing left to do.
export type FinishedPriority = 0 | 1 | 2;

type FinishedRow = Pick<CallRow, "status" | "purpose" | "brief" | "result" | "completed_at" | "decided_at" | "created_at">;

export function finishedPriority(row: FinishedRow): FinishedPriority {
  if (suggestedActions(row).length > 0) return 0;
  const outcome = row.result?.outcome;
  if (row.status === "failed" || (outcome !== undefined && outcome !== "resolved") || row.result?.follow_up?.trim()) return 1;
  if (row.result?.switch?.recommend) return 1; // a new supplier was suggested
  return 2;
}

const finishedAt = (row: FinishedRow) => new Date(row.completed_at ?? row.decided_at ?? row.created_at).getTime();

// Recent calls first; among those, the ones that still need something; newest first within each.
export function sortFinished<T extends FinishedRow>(rows: T[], now?: Date): T[] {
  // Only read the clock when there's something to sort: the panel is prerendered with an
  // empty list, and Next.js refuses `new Date()` during a prerender.
  if (rows.length < 2) return rows;
  const cutoff = (now ?? new Date()).getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const key = (r: T) => [finishedAt(r) >= cutoff ? 0 : 1, finishedPriority(r), -finishedAt(r)];
  return [...rows].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
}
