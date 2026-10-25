import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import ActionCard from "@/components/agent/ActionCard";
import CaseList from "@/components/agent/CaseList";
import RunNow from "@/components/agent/RunNow";
import AttentionList from "@/components/attention/AttentionList";
import CallRequests from "@/components/calls/CallRequests";
import ErrorMessage from "@/components/ErrorMessage";
import { AREA_STYLE } from "@/components/intelligence/areaStyle";
import LiveRefresh from "@/components/live/LiveRefresh";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { SuggestionCard } from "@/app/menu/parts";
import { SkeletonLines } from "@/components/ui/Skeleton";
import { ACTION_STATUSES, ActionTableMissing, supabaseActions, type ActionStatus } from "@/lib/agent/actions";
import { boardContext, loadBoard } from "@/lib/approvals/board";
import { BOARD, BOARD_INFO, placeAction, type Placed } from "@/lib/approvals/sections";
import { AREA_INFO } from "@/lib/intelligence/types";
import { CasesTableMissing, listCases } from "@/lib/loop/store";
import { getSupabase } from "@/lib/supabase";

export const metadata: Metadata = { title: "Actions" };

const FILTERS: { status: ActionStatus | null; label: string }[] = [
  { status: null, label: "All" },
  { status: "done", label: "Done" },
  { status: "failed", label: "Failed" },
  { status: "rejected", label: "Turned down" },
  { status: "expired", label: "Expired" },
];

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const SOURCE: Record<string, string> = { agent: "Proposed by the assistant", loop: "Found by Resta on its own", owner: "Done by you on a page" };

// Which department an approval is filed under, and for Mixed, which departments and why.
function Filed({ placed }: { placed: Placed }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {placed.areas.map((a) => (
        <span key={a} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${AREA_STYLE[a].chip}`}>{AREA_INFO[a].label}</span>
      ))}
    </span>
  );
}

async function Cases() {
  let cases;
  try {
    cases = await listCases(await getSupabase(), { limit: 50 });
  } catch (err) {
    if (err instanceof CasesTableMissing) return <ErrorMessage message="The loop isn't set up yet. Run supabase/19_cases.sql in the Supabase SQL editor." />;
    return <ErrorMessage message={err instanceof Error ? err.message : "Could not load the cases."} />;
  }
  return <CaseList cases={cases} />;
}

// Everything waiting for the owner, one section per department, and Mixed for approvals whose
// evidence came from more than one. This is the only page with Approve buttons.
async function Waiting() {
  const board = await loadBoard(await getSupabase());
  const count = (s: (typeof BOARD)[number]) => board.sections[s].actions.length + board.sections[s].items.length + (s === "menu" ? board.suggestions.length : 0);
  const total = BOARD.reduce((n, s) => n + count(s), 0);
  return (
    <div className="space-y-6">
      {board.errors.length > 0 && <ErrorMessage message={`Some approvals couldn't be loaded: ${board.errors.join("; ")}`} />}
      <nav aria-label="Sections" className="flex flex-wrap gap-2">
        {BOARD.map((s) => {
          const n = count(s);
          return (
            <a key={s} href={`#${s}`} className={`rounded-full px-3 py-1 text-sm ${n ? "bg-brand-600 text-white" : "border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
              {BOARD_INFO[s].label}{n ? ` ${n}` : ""}
            </a>
          );
        })}
      </nav>
      {total === 0 && <p className="text-sm text-gray-500">No proposals or orders are waiting. Supplier calls waiting for your OK are under Purchasing and suppliers.</p>}
      {BOARD.map((s) => {
        const { actions, items } = board.sections[s];
        const suggestions = s === "menu" ? board.suggestions : [];
        const empty = count(s) === 0;
        return (
          <section key={s} id={s} aria-labelledby={`${s}-title`} className="scroll-mt-6 rounded-2xl border border-brand-100 bg-white p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`${s}-title`} className="flex items-center gap-2 font-semibold text-gray-900">
                <span className="h-4 w-1 rounded-full bg-brand-500" aria-hidden="true" />
                {BOARD_INFO[s].label}
              </h2>
              <p className="text-xs text-gray-500">{BOARD_INFO[s].hint}</p>
            </div>
            {empty && s !== "purchasing" && <p className="text-sm text-gray-500">Nothing waiting.</p>}
            {actions.length > 0 && (
              <ul className="space-y-3">
                {actions.map((a) => (
                  <li key={a.id}>
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                      <span>#{a.id} · {when(a.created_at)} · {SOURCE[a.source] ?? a.source}</span>
                      {s === "mixed" && <Filed placed={a.placed} />}
                    </div>
                    {a.placed.reason && s === "mixed" && <p className="mb-1 text-xs text-gray-600">{a.placed.reason}</p>}
                    <ActionCard action={a} />
                  </li>
                ))}
              </ul>
            )}
            {suggestions.length > 0 && (
              <div className={`grid gap-3 md:grid-cols-2 ${actions.length ? "mt-4 border-t border-gray-100 pt-4" : ""}`}>
                {suggestions.map((sg) => <SuggestionCard key={sg.dish.id} s={sg} approveHere />)}
              </div>
            )}
            {items.length > 0 && (
              <div className={actions.length || suggestions.length ? "mt-4 border-t border-gray-100 pt-4" : ""}>
                <AttentionList items={items} approveHere limit={50} />
              </div>
            )}
            {s === "purchasing" && (
              <div className={empty ? "" : "mt-4 border-t border-gray-100 pt-4"}>
                <CallRequests title="Supplier calls waiting for your OK" approveHere waitingOnly skipIds={board.skipCallIds} hideWhenEmpty={!empty} view="full" />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

async function History({ status }: { status: ActionStatus | null }) {
  const db = await getSupabase();
  let actions;
  try {
    actions = (await supabaseActions(db).list({ status: status ?? undefined, limit: 100 })).filter((a) => a.status !== "proposed");
  } catch (err) {
    if (err instanceof ActionTableMissing) return <ErrorMessage message="The action log isn't set up yet. Run supabase/18_agent_actions.sql in the Supabase SQL editor." />;
    return <ErrorMessage message={err instanceof Error ? err.message : "Could not load the actions."} />;
  }
  const context = await boardContext(db);
  return (
    <>
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = f.status === status;
          return (
            <Link
              key={f.label}
              href={f.status ? `/actions?tab=history&status=${f.status}` : "/actions?tab=history"}
              aria-current={on ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-sm ${on ? "bg-brand-600 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"}`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>
      {actions.length === 0 ? (
        <EmptyState title={status ? "Nothing here with that status." : "Nothing decided yet. What you approve or turn down shows up here."} icon="check" />
      ) : (
        <ul className="space-y-3">
          {actions.map((a) => {
            const placed = placeAction(a, context);
            return (
              <li key={a.id}>
                <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                  <span>
                    #{a.id} · {when(a.created_at)} · {SOURCE[a.source] ?? a.source}
                    {a.approved_by ? ` · decided by ${a.approved_by}` : ""} · {BOARD_INFO[placed.section].label}
                  </span>
                  {placed.section === "mixed" && <Filed placed={placed} />}
                </div>
                <ActionCard action={a} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

async function Tabs({ searchParams }: { searchParams: PageProps<"/actions">["searchParams"] }) {
  const params = await searchParams;
  const raw = typeof params.status === "string" ? params.status : null;
  const status = raw && raw !== "proposed" && (ACTION_STATUSES as readonly string[]).includes(raw) ? (raw as ActionStatus) : null;
  // Old links: ?status=done opens History; ?status=proposed is the waiting board
  const tab = params.tab === "cases" ? "cases" : params.tab === "history" || status ? "history" : "waiting";
  const cls = (on: boolean) => `border-b-2 px-1 pb-2 text-sm font-medium ${on ? "border-brand-600 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900"}`;
  return (
    <>
      <nav aria-label="Actions" className="mb-4 flex gap-6 border-b border-gray-200">
        <Link href="/actions" aria-current={tab === "waiting" ? "page" : undefined} className={cls(tab === "waiting")}>Waiting for you</Link>
        <Link href="/actions?tab=history" aria-current={tab === "history" ? "page" : undefined} className={cls(tab === "history")}>History</Link>
        <Link href="/actions?tab=cases" aria-current={tab === "cases" ? "page" : undefined} className={cls(tab === "cases")}>Cases</Link>
      </nav>
      {tab === "cases" ? <Cases /> : tab === "history" ? <History status={status} /> : <Waiting />}
    </>
  );
}

// Every approval in one place, filed by department (Mixed when it came from more than one): the
// assistant's and the loop's proposals, draft orders and price changes, and supplier calls. Other
// pages show the context and link here. History is what was decided; Cases is what the loop found.
export default function ActionsPage({ searchParams }: PageProps<"/actions">) {
  return (
    <div>
      <LiveRefresh topics={["actions"]} />
      <PageHeader title="Actions" description="Everything waiting for your OK, by department, and what was decided. Nothing that spends money, changes a price or contacts someone runs without your tap here." />
      <RunNow />
      <Suspense fallback={<SkeletonLines />}>
        <Tabs searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
