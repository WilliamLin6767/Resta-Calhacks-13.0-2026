"use client";

// Supplier call requests for one record (an invoice, supplier, ingredient or
// purchase order), or for a whole page. Pending: approve, edit or reject.
// Calling: live status. Done: the outcome, transcript and suggested actions.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { followCalls } from "@/components/live/followedCalls";
import { LIVE_RESTAURANT_ID, useLiveOn, useLiveQuery } from "@/components/live/useLiveQuery";
import EmptyState from "@/components/ui/EmptyState";
import Fold from "@/components/ui/Fold";
import { SkeletonLines } from "@/components/ui/Skeleton";
import { api } from "@/convex/_generated/api";
import { formatPhone } from "@/lib/calls/phone";
import type { CallView } from "@/lib/calls/service";
import { mergeLiveCalls } from "@/lib/live/mergeCalls";
import { CALL_STEPS, FINISHED_STATUSES, callStep, finishedPriority, needsSwitchCheck, sortFinished, type Brief, type ContextType, type SwitchCheck } from "@/lib/calls/types";

export const CALLS_CHANGED = "calls-changed";
export function announceCallsChanged() {
  window.dispatchEvent(new Event(CALLS_CHANGED));
}

const button = "rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";
const primary = "rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50";

const STATUS: Record<CallView["status"], { label: string; className: string }> = {
  pending: { label: "Waiting for your OK", className: "bg-amber-50 text-amber-800" },
  approved: { label: "Starting the call", className: "bg-blue-50 text-blue-800" },
  calling: { label: "Calling", className: "bg-blue-50 text-blue-800" },
  needs_input: { label: "Calling", className: "bg-blue-50 text-blue-800" },
  completed: { label: "Done", className: "bg-green-50 text-green-800" },
  failed: { label: "Didn't work", className: "bg-red-50 text-red-700" },
  rejected: { label: "Rejected", className: "bg-gray-100 text-gray-600" },
};

const PURPOSE: Record<CallView["purpose"], string> = {
  dispute: "Dispute",
  buy: "Order",
  info: "Question",
  special_request: "Your request",
};

const money = (n: number) => `$${n.toFixed(2)}`;

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

// ---------------------------------------------------------------------
// The brief, readable and editable
// ---------------------------------------------------------------------

function BriefView({ brief }: { brief: Brief }) {
  const { min_credit, max_packs, max_total, notes } = brief.limits;
  return (
    <dl className="mt-2 space-y-1 rounded-md bg-gray-50 px-3 py-2 text-sm">
      <div><dt className="inline font-medium">Goal: </dt><dd className="inline">{brief.goal}</dd></div>
      {brief.ask_for && <div><dt className="inline font-medium">Ask for: </dt><dd className="inline">{brief.ask_for}</dd></div>}
      {brief.facts.length > 0 && (
        <div>
          <dt className="font-medium">Facts</dt>
          <dd><ul className="list-disc pl-5">{brief.facts.map((f, i) => <li key={i}>{f}</li>)}</ul></dd>
        </div>
      )}
      {brief.questions.length > 0 && (
        <div>
          <dt className="font-medium">Questions</dt>
          <dd><ul className="list-disc pl-5">{brief.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></dd>
        </div>
      )}
      {brief.wanted_by && <div><dt className="inline font-medium">Wanted by: </dt><dd className="inline">{brief.wanted_by}</dd></div>}
      <div>
        <dt className="font-medium">May agree to</dt>
        <dd>
          <ul className="list-disc pl-5">
            {min_credit > 0 && <li>A credit or corrected invoice of at least {money(min_credit)}</li>}
            {(max_packs > 0 || max_total > 0) && (
              <li>
                An order of {[max_packs > 0 ? `at most ${max_packs} packs` : "", max_total > 0 ? `at most ${money(max_total)}` : ""].filter(Boolean).join(", ")}
              </li>
            )}
            {notes && <li>{notes}</li>}
            <li>Nothing else: no card details, no new terms. It says it&apos;s an AI and asks them to confirm in writing.</li>
          </ul>
        </dd>
      </div>
    </dl>
  );
}

function BriefEditor({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  const field = "mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-brand-600";
  const num = (v: string) => Math.max(0, Number(v) || 0);
  const set = (patch: Partial<Brief>) => onChange({ ...brief, ...patch });
  const setLimit = (patch: Partial<Brief["limits"]>) => onChange({ ...brief, limits: { ...brief.limits, ...patch } });
  return (
    <div className="mt-2 grid gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm">
      <label>Goal<input className={field} value={brief.goal} onChange={(e) => set({ goal: e.target.value })} /></label>
      <label>Ask for<input className={field} value={brief.ask_for} onChange={(e) => set({ ask_for: e.target.value })} placeholder="Contact name, or accounts / orders" /></label>
      <label>Facts (one per line)<textarea className={field} rows={3} defaultValue={brief.facts.join("\n")} onChange={(e) => set({ facts: lines(e.target.value) })} /></label>
      <label>Questions (one per line)<textarea className={field} rows={2} defaultValue={brief.questions.join("\n")} onChange={(e) => set({ questions: lines(e.target.value) })} /></label>
      <label>Wanted by<input className={field} value={brief.wanted_by} onChange={(e) => set({ wanted_by: e.target.value })} placeholder="YYYY-MM-DD, or leave empty" /></label>
      <div className="grid grid-cols-3 gap-2">
        <label>Min credit ($)<input type="number" min={0} step="0.01" className={field} value={brief.limits.min_credit} onChange={(e) => setLimit({ min_credit: num(e.target.value) })} /></label>
        <label>Max packs<input type="number" min={0} className={field} value={brief.limits.max_packs} onChange={(e) => setLimit({ max_packs: num(e.target.value) })} /></label>
        <label>Max total ($)<input type="number" min={0} step="0.01" className={field} value={brief.limits.max_total} onChange={(e) => setLimit({ max_total: num(e.target.value) })} /></label>
      </div>
      <p className="text-xs text-gray-500">0 means not allowed. Card details and new terms are always refused.</p>
      <label>Other limits<input className={field} value={brief.limits.notes} onChange={(e) => setLimit({ notes: e.target.value })} /></label>
    </div>
  );
}

// ---------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------

function DialLine({ call }: { call: CallView }) {
  const dial = call.result?.dial ?? call.dial;
  if (!dial) return <p className="text-sm text-red-700">No usable phone number on file for {call.supplier.name}.</p>;
  const done = call.status !== "pending";
  if (dial.override) {
    return (
      <p className="text-sm text-gray-700">
        Demo override: {done ? "called" : "calls"} <span className="font-medium">{formatPhone(dial.dial)}</span>
        <span className="text-gray-500"> (supplier&apos;s number {formatPhone(dial.supplier_number)})</span>
      </p>
    );
  }
  return <p className="text-sm text-gray-700">{done ? "Called" : "Will call"} <span className="font-medium">{formatPhone(dial.dial)}</span></p>;
}

function ResultFacts({ call }: { call: CallView }) {
  const r = call.result;
  if (!r || r.outcome === undefined) return null;
  const items = [
    r.reached_person ? "Reached a person" : "Didn't reach a person",
    r.credit_amount ? `Credit: ${money(r.credit_amount)}` : "",
    r.new_price ? `New price: ${money(r.new_price)} a pack${r.effective_date ? ` from ${r.effective_date}` : ""}` : "",
    r.delivery_eta ? `Delivery: ${r.delivery_eta}` : "",
    r.order_confirmed ? "Order confirmed" : "",
  ].filter(Boolean);
  return (
    <div className="mt-2 text-sm">
      <p className="text-gray-600">{items.join(" · ")}</p>
      {r.follow_up && <p className="mt-1"><span className="font-medium">Follow up: </span>{r.follow_up}</p>}
    </div>
  );
}

// m:ss since `since`, ticking every second while `running`.
function useElapsed(since: string | null, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!since || !running) return "";
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Starting the call -> On the phone -> Summarizing -> Done.
function CallProgress({ step, supplier, since }: { step: number; supplier: string; since: string | null }) {
  const running = step < 3;
  const elapsed = useElapsed(since, running);
  const line = ["Starting the call...", `On the phone with ${supplier}...`, "The call is over. Claude is summarizing what was said..."][step];
  return (
    <div>
      <div
        role="progressbar"
        aria-label="Call progress"
        aria-valuemin={1}
        aria-valuemax={CALL_STEPS.length}
        aria-valuenow={step + 1}
        aria-valuetext={CALL_STEPS[step]}
        className="flex gap-1"
      >
        {CALL_STEPS.map((label, i) => (
          <div key={label} className="flex-1">
            <div
              className={`h-1.5 rounded-full ${
                i < step || !running ? "bg-accent" : i === step ? "bg-accent/60 motion-safe:animate-pulse" : "bg-gray-100"
              }`}
            />
            <p className={`mt-1 text-xs ${i === step ? "font-medium text-gray-900" : "text-gray-500"}`}>{label}</p>
          </div>
        ))}
      </div>
      {running && (
        <p aria-live="polite" className="mt-2 text-sm text-gray-700">
          {line}
          {elapsed && <span className="text-gray-400"> · {elapsed}</span>}
        </p>
      )}
    </div>
  );
}

const wholeMoney = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// After a supply problem: what it puts at risk, the pros and cons of switching, and the
// suggested new supplier (whose call waits for approval in the list above).
function SwitchSuggestion({ check, supplier, busy, onCheckAgain }: { check: SwitchCheck; supplier: string; busy: boolean; onCheckAgain: () => void }) {
  if (check.status === "checking") {
    return (
      <div aria-live="polite" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
        <span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-600 motion-safe:animate-pulse" aria-hidden="true" />
        Supply problem found. Checking what it means for sales and whether another supplier makes sense...
      </div>
    );
  }
  if (check.status === "error") {
    return (
      <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Couldn&apos;t check other suppliers: {check.error}
        <button className={`${button} ml-2`} disabled={busy} onClick={onCheckAgain}>
          {busy ? "Checking..." : "Check suppliers again"}
        </button>
      </div>
    );
  }
  const impact = check.impact;
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${check.recommend ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"}`}>
      <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">
        {check.recommend && check.lead ? `Suggested: try ${check.lead.company_name}` : `Supplier check: staying with ${supplier} for now`}
      </p>
      <p className="mt-1 text-gray-900">{check.verdict}</p>
      {impact && (
        <p className="mt-1 text-gray-600">
          {impact.dishes.length
            ? `${impact.ingredient} goes into ${impact.dishes.map((d) => d.name).join(", ")}: ${wholeMoney(impact.revenue_at_risk_30d)} of sales in the last 30 days${
                impact.share_of_revenue_pct !== null ? ` (${impact.share_of_revenue_pct}% of revenue)` : ""
              }.`
            : `No dish on the menu uses ${impact.ingredient}.`}
          {impact.days_left !== null && ` About ${impact.days_left} days of stock left.`}
        </p>
      )}
      {((check.pros?.length ?? 0) > 0 || (check.cons?.length ?? 0) > 0) && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="font-medium text-gray-900">For switching</p>
            <ul className="list-disc pl-5 text-gray-700">{check.pros?.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
          <div>
            <p className="font-medium text-gray-900">Against</p>
            <ul className="list-disc pl-5 text-gray-700">{check.cons?.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        </div>
      )}
      {check.recommend && check.lead && (
        <p className="mt-2 text-gray-700">
          {check.lead.company_name}
          {check.lead.city ? ` (${check.lead.city}${check.lead.state ? `, ${check.lead.state}` : ""})` : ""}
          {check.lead.source === "on_file" ? " is already one of your suppliers." : " is from the ThomasNet supplier search, saved as a prospect supplier."}{" "}
          {check.follow_up_call_id !== undefined && (
            <a href={`#call-${check.follow_up_call_id}`} className="font-medium text-gray-900 underline">
              Review the call to {check.lead.company_name} (waiting for your OK) ↑
            </a>
          )}
        </p>
      )}
      {!check.recommend && check.no_leads_reason && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-amber-900">Nobody to switch to yet: {check.no_leads_reason}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="text-xs text-gray-500">
          {check.leads_considered ?? 0} possible supplier{check.leads_considered === 1 ? "" : "s"} considered{check.searched_apify ? " (searched ThomasNet just now)" : ""}.
        </p>
        {!check.recommend && (
          <button className={button} disabled={busy} onClick={onCheckAgain}>
            {busy ? "Checking..." : "Check suppliers again"}
          </button>
        )}
      </div>
    </div>
  );
}

// `compact` (older finished calls): the summary and buttons only, the rest behind "More details".
function CallCard({ call, onChanged, compact = false }: { call: CallView; onChanged: (c?: Partial<CallView>) => void; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [full, setFull] = useState(!compact);
  const [draft, setDraft] = useState<Brief>(call.brief);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false); // shows the progress bar while Wajo starts the call
  const [error, setError] = useState("");
  const status = STATUS[call.status];
  const step = callStep(call);

  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await post(path, body);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setApproving(false);
    }
  }

  // The editable part of the brief; refs (which flags, which order) stay as stored.
  const editedBrief: Brief = { goal: draft.goal, ask_for: draft.ask_for, facts: draft.facts, questions: draft.questions, wanted_by: draft.wanted_by, limits: draft.limits };

  return (
    <li id={`call-${call.id}`} className={`scroll-mt-4 rounded-2xl border bg-white p-4 ${call.status === "pending" ? "border-amber-300" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {call.title}
          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">{PURPOSE[call.purpose]}</span>
          {call.proposed_by === "ai" && <span className="ml-1 text-xs font-normal text-gray-500">suggested by the app</span>}
        </p>
        <span className="flex gap-1">
          {FINISHED_STATUSES.includes(call.status) && finishedPriority(call) < 2 && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              {finishedPriority(call) === 0 ? "To do" : "Follow up"}
            </span>
          )}
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
            {/* On a live call: a dot with a soft ring spreading out (still with reduced motion) */}
            {(call.status === "calling" || call.status === "needs_input") && (
              <span className="relative mr-1.5 inline-flex h-2 w-2" aria-hidden="true">
                <span className="live-pulse absolute inset-0 rounded-full bg-blue-500" />
                <span className="relative h-2 w-2 rounded-full bg-blue-600" />
              </span>
            )}
            {status.label}
          </span>
        </span>
      </div>
      <p className="text-sm text-gray-600">{call.supplier.name}{call.supplier.contact_name ? ` · ask for ${call.supplier.contact_name}` : ""}</p>
      {call.status === "pending" && <p className="mt-1 text-sm text-gray-800">{call.reason}</p>}

      {call.status === "pending" && !approving && (
        <>
          <div className="mt-2"><DialLine call={call} /></div>
          {editing ? (
            <BriefEditor brief={draft} onChange={setDraft} />
          ) : (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">See what the AI will say and agree to</summary>
              <BriefView brief={call.brief} />
            </details>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className={primary}
              disabled={busy || !call.dial}
              onClick={() => {
                setApproving(true);
                act(`/api/calls/${call.id}/decide`, { approve: true, ...(editing ? { brief: editedBrief } : {}) });
              }}
            >
              Approve and call
            </button>
            <button className={button} disabled={busy} onClick={() => (editing ? (setEditing(false), setDraft(call.brief)) : setEditing(true))}>
              {editing ? "Cancel edit" : "Edit"}
            </button>
            <button className={button} disabled={busy} onClick={() => act(`/api/calls/${call.id}/decide`, { approve: false })}>
              Reject
            </button>
          </div>
        </>
      )}

      {/* While approving and during the call: a progress bar. The questions the caller asks and
          our answers happen in the background; only the step shows. */}
      {(approving || (step !== null && step < 3)) && (
        <div className="mt-3 space-y-2">
          <DialLine call={call} />
          <CallProgress step={approving ? 0 : step!} supplier={call.supplier.name} since={call.decided_at} />
        </div>
      )}

      {call.status === "completed" && (
        <div className="mt-3 space-y-2">
          {full && <CallProgress step={3} supplier={call.supplier.name} since={null} />}
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">Summary</p>
            <p className="mt-1 text-sm text-gray-900">{call.outcome}</p>
            <ResultFacts call={call} />
          </div>
          {full && call.result?.switch && (
            <SwitchSuggestion
              check={call.result.switch}
              supplier={call.supplier.name}
              busy={busy}
              onCheckAgain={() => act(`/api/calls/${call.id}/switch`, {})}
            />
          )}
          {call.actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {call.actions.map((a) => (
                <button key={a.id} className={primary} disabled={busy} onClick={() => act(`/api/calls/${call.id}/apply`, { action: a.id })}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {call.status === "failed" && <p className="mt-2 text-sm text-red-700">{call.error ?? "The call didn't go through."}</p>}

      {/* The caller sometimes reports after the app stopped checking: read Wajo again (never dials). */}
      {full &&
        call.wajo_call_id &&
        (call.status === "failed" || (call.status === "completed" && (call.result?.outcome === "callback_needed" || call.result?.outcome === "no_answer"))) && (
          <button className={`${button} mt-2`} disabled={busy} onClick={() => act(`/api/calls/${call.id}/recheck`, {})}>
            {busy ? "Checking..." : "Check Wajo again"}
          </button>
        )}
      {call.error && call.status === "completed" && <p className="mt-1 text-xs text-gray-500">{call.error}</p>}

      {/* The raw back-and-forth with the calling agent, only once the call is over and only if opened. */}
      {full && (call.status === "completed" || call.status === "failed") && (call.transcript || (call.result?.qa?.length ?? 0) > 0) && (
        <details className="mt-2 text-xs text-gray-500">
          <summary className="cursor-pointer hover:text-gray-700">Behind the scenes</summary>
          {(call.result?.qa?.length ?? 0) > 0 && (
            <ul className="mt-1 space-y-1">
              {call.result!.qa!.map((q, i) => (
                <li key={i}>The calling agent asked: {q.question}<br />Claude answered: {q.answer}</li>
              ))}
            </ul>
          )}
          {call.transcript && <p className="mt-1 whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2">{call.transcript}</p>}
        </details>
      )}
      {compact && (
        <button className="mt-2 text-xs text-gray-500 hover:text-gray-800 hover:underline" onClick={() => setFull(!full)} aria-expanded={full}>
          {full ? "Fewer details" : "More details"}
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}

// ---------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------

const ACTIVE: CallView["status"][] = ["approved", "calling", "needs_input"];

// Still worth checking on: the call is running, or it's done and the supplier-switch check
// (after a supply problem) hasn't finished yet. The status route starts that check.
const followed = (c: Pick<CallView, "status" | "brief" | "result">) =>
  ACTIVE.includes(c.status) || needsSwitchCheck(c) || (c.status === "completed" && c.result?.switch?.status === "checking");

export default function CallRequests({
  contextType,
  contextId,
  supplierId,
  title = "Supplier calls",
  hideWhenEmpty = false,
  action,
}: {
  contextType?: ContextType;
  contextId?: number;
  supplierId?: number;
  title?: string;
  hideWhenEmpty?: boolean;
  action?: React.ReactNode; // shown next to the heading, e.g. the "Check for calls" button
}) {
  const router = useRouter();
  const [calls, setCalls] = useState<CallView[] | null>(null);
  const [error, setError] = useState("");
  // Calls the owner watched finish here stay up top until the page reloads, so they don't
  // vanish into the folded "Finished calls" while being read.
  const [watched, setWatched] = useState<Set<number>>(new Set());

  const query = new URLSearchParams({
    ...(contextType ? { context_type: contextType } : {}),
    ...(contextId !== undefined ? { context_id: String(contextId) } : {}),
    ...(supplierId !== undefined ? { supplier_id: String(supplierId) } : {}),
  }).toString();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/calls?${query}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't load calls.");
      setCalls(data.calls);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [query]);

  useEffect(() => {
    // Loading data from the API when the panel appears; nothing to render until it arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    window.addEventListener(CALLS_CHANGED, load);
    return () => window.removeEventListener(CALLS_CHANGED, load);
  }, [load]);

  // With Convex on, changes to these calls are pushed from any screen: fold them into the rows,
  // and load the full rows again when a call appears or finishes.
  const liveOn = useLiveOn();
  const liveCalls = useLiveQuery(
    api.live.callsFor,
    liveOn ? { restaurantId: LIVE_RESTAURANT_ID, contextType, contextId: contextType ? contextId : undefined, supplierId: contextType ? undefined : supplierId } : "skip"
  );
  const seen = useRef(new Map<number, number>());
  useEffect(() => {
    if (!liveCalls || calls === null) return;
    const merged = mergeLiveCalls(calls, liveCalls, seen.current);
    // Pushed by Convex: show it (the merge returns the same rows when nothing new arrived)
    if (merged.rows !== calls) setCalls(merged.rows);
    if (merged.reload) load();
  }, [liveCalls, calls, load]);

  // While a call runs (or its switch check does), ask for its status every 3 seconds
  // (the server checks Wajo at most every 5). With Convex on this only moves the call forward;
  // the update itself arrives from Convex.
  const activeIds = (calls ?? []).filter(followed).map((c) => c.id).join(",");
  useEffect(() => {
    if (!activeIds) return;
    const unfollow = followCalls(activeIds.split(",").map(Number));
    const timer = window.setInterval(async () => {
      const updates = await Promise.all(
        activeIds.split(",").map((id) => fetch(`/api/calls/${id}/status`).then((r) => r.json()).catch(() => null))
      );
      const done = updates.filter((u) => u?.call && !followed(u.call)).map((u) => u.call.id as number);
      const finished = done.length > 0;
      if (finished) setWatched((w) => new Set([...w, ...done]));
      if (!liveOn) {
        setCalls((prev) =>
          (prev ?? []).map((c) => {
            const u = updates.find((x) => x?.call?.id === c.id)?.call;
            return u ? { ...c, ...u, supplier: c.supplier, dial: c.dial, actions: c.actions } : c;
          })
        );
      }
      if (finished) {
        load(); // picks up the suggested actions, and a new call from the switch check
        announceCallsChanged();
      }
    }, 3000);
    return () => {
      window.clearInterval(timer);
      unfollow();
    };
  }, [activeIds, load, liveOn]);

  const changed = () => {
    load();
    announceCallsChanged();
    router.refresh(); // badges in server-rendered lists
  };

  if (hideWhenEmpty && calls !== null && calls.length === 0 && !error) return null;
  const all = calls ?? [];
  const isFinished = (c: CallView) => FINISHED_STATUSES.includes(c.status) && !watched.has(c.id);
  // Waiting for the owner's OK or under way, newest first (as the API sends them).
  const open = all.filter((c) => c.status !== "rejected" && !isFinished(c));
  // Done or didn't work: their own list, most important first.
  const finished = sortFinished(all.filter(isFinished));
  const rejected = all.filter((c) => c.status === "rejected").length;
  const waiting = open.filter((c) => c.status === "pending").length;
  const live = open.filter((c) => ACTIVE.includes(c.status)).length;
  const justDone = open.length - waiting - live;
  const finishedToDo = finished.filter((c) => finishedPriority(c) < 2).length;

  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {calls === null && !error && <SkeletonLines lines={3} className="rounded-2xl border border-brand-100 bg-white p-4" />}
      {calls !== null && all.length === 0 && <EmptyState title="No calls here." icon="truck" />}
      {calls !== null && all.length > 0 && (
        <Fold
          summary={
            <>
              {waiting > 0 && (
                <span className="flex items-center gap-2 font-medium text-gray-900"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />{waiting} waiting for your OK</span>
              )}
              {live > 0 && (
                <span className="flex items-center gap-2 font-medium text-gray-900">
                  <span className="relative inline-flex h-2 w-2" aria-hidden="true">
                    <span className="live-pulse absolute inset-0 rounded-full bg-blue-500" />
                    <span className="relative h-2 w-2 rounded-full bg-blue-600" />
                  </span>
                  {live} on the phone now
                </span>
              )}
              {justDone > 0 && <span className="text-gray-600">{justDone} just finished</span>}
              {finished.length > 0 && (
                <span className="text-gray-600">
                  {finished.length} finished{finishedToDo > 0 ? ` (${finishedToDo} need${finishedToDo === 1 ? "s" : ""} you)` : ""}
                </span>
              )}
              {open.length === 0 && finished.length === 0 && <span className="text-gray-600">No calls waiting for your OK</span>}
            </>
          }
        >
          <div className="space-y-2">
            {open.length === 0 && <p className="px-1 text-sm text-gray-600">No calls waiting for your OK.</p>}
            <ul className="grid gap-3">
              {open.map((c) => (
                <CallCard key={`${c.id}-${c.status}`} call={c} onChanged={changed} />
              ))}
            </ul>
            {rejected > 0 && <p className="text-xs text-gray-500">{rejected} rejected request{rejected === 1 ? "" : "s"} hidden.</p>}
            {finished.length > 0 && <FinishedCalls calls={finished} onChanged={changed} />}
          </div>
        </Fold>
      )}
    </section>
  );
}

const FINISHED_SHOWN = 5;

// The "finished" folder, folded: calls that still need something on top, older and settled ones
// further down, each one short until opened.
function FinishedCalls({ calls, onChanged }: { calls: CallView[]; onChanged: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? calls : calls.slice(0, FINISHED_SHOWN);
  const toDo = calls.filter((c) => finishedPriority(c) < 2).length;
  return (
    <Fold
      summary={
        <>
          <span className="font-semibold text-gray-900">Finished calls ({calls.length})</span>
          {toDo > 0 && (
            <span className="flex items-center gap-2 text-gray-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />{toDo} need{toDo === 1 ? "s" : ""} something from you</span>
          )}
        </>
      }
    >
      <p className="px-1 text-xs text-gray-500">Most important first: calls with something left to do, then the newest.</p>
      <ul className="mt-2 grid gap-3">
        {shown.map((c) => (
          <CallCard key={`${c.id}-${c.status}`} call={c} onChanged={onChanged} compact />
        ))}
      </ul>
      {calls.length > FINISHED_SHOWN && (
        <button className={`${button} mt-3`} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show ${calls.length - FINISHED_SHOWN} older`}
        </button>
      )}
    </Fold>
  );
}
