import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import ActionCard from "@/components/agent/ActionCard";
import CaseList from "@/components/agent/CaseList";
import RunNow from "@/components/agent/RunNow";
import ErrorMessage from "@/components/ErrorMessage";
import LiveRefresh from "@/components/live/LiveRefresh";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonLines } from "@/components/ui/Skeleton";
import { ACTION_STATUSES, ActionTableMissing, supabaseActions, type ActionStatus } from "@/lib/agent/actions";
import { CasesTableMissing, listCases } from "@/lib/loop/store";
import { getSupabase } from "@/lib/supabase";

export const metadata: Metadata = { title: "Actions" };

const FILTERS: { status: ActionStatus | null; label: string }[] = [
  { status: null, label: "All" },
  { status: "proposed", label: "Waiting for you" },
  { status: "done", label: "Done" },
  { status: "failed", label: "Failed" },
  { status: "rejected", label: "Turned down" },
];

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const SOURCE: Record<string, string> = { agent: "Proposed by the assistant", loop: "Found by Resta on its own", owner: "Done by you on a page" };

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

async function Tabs({ searchParams }: { searchParams: PageProps<"/actions">["searchParams"] }) {
  const params = await searchParams;
  const cases = params.tab === "cases";
  const tab = (on: boolean) => `border-b-2 px-1 pb-2 text-sm font-medium ${on ? "border-brand-600 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900"}`;
  return (
    <>
      <nav aria-label="Actions or cases" className="mb-4 flex gap-6 border-b border-gray-200">
        <Link href="/actions" aria-current={!cases ? "page" : undefined} className={tab(!cases)}>Actions</Link>
        <Link href="/actions?tab=cases" aria-current={cases ? "page" : undefined} className={tab(cases)}>Cases</Link>
      </nav>
      {cases ? <Cases /> : <ActionList searchParams={searchParams} />}
    </>
  );
}

async function ActionList({ searchParams }: { searchParams: PageProps<"/actions">["searchParams"] }) {
  const params = await searchParams;
  const raw = typeof params.status === "string" ? params.status : null;
  const status = raw && (ACTION_STATUSES as readonly string[]).includes(raw) ? (raw as ActionStatus) : null;

  let actions;
  try {
    actions = await supabaseActions(await getSupabase()).list({ status: status ?? undefined, limit: 100 });
  } catch (err) {
    if (err instanceof ActionTableMissing) return <ErrorMessage message="The action log isn't set up yet. Run supabase/18_agent_actions.sql in the Supabase SQL editor." />;
    return <ErrorMessage message={err instanceof Error ? err.message : "Could not load the actions."} />;
  }

  return (
    <>
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = f.status === status;
          return (
            <Link
              key={f.label}
              href={f.status ? `/actions?status=${f.status}` : "/actions"}
              aria-current={on ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-sm ${on ? "bg-brand-600 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"}`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>
      {actions.length === 0 ? (
        <EmptyState title={status ? "Nothing here with that status." : "No actions yet. Proposals from the assistant and your approvals show up here."} icon="check" />
      ) : (
        <ul className="space-y-3">
          {actions.map((a) => (
            <li key={a.id}>
              <p className="mb-1 text-xs text-gray-500">
                #{a.id} · {when(a.created_at)} · {SOURCE[a.source] ?? a.source}
                {a.approved_by ? ` · decided by ${a.approved_by}` : ""}
              </p>
              <ActionCard action={a} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// Every Commit action, newest first: what the assistant proposed, what the owner approved or
// turned down on a card, and what the owner did with a page button. Nothing runs from here
// without a tap on Approve. The Cases tab shows what the loop found and how it went; Run now
// starts the loop on demand.
export default function ActionsPage({ searchParams }: PageProps<"/actions">) {
  return (
    <div>
      <LiveRefresh topics={["actions"]} />
      <PageHeader title="Actions" description="Everything that spends money, changes a price or contacts someone: proposed, approved, done. Nothing runs without your tap." />
      <RunNow />
      <Suspense fallback={<SkeletonLines />}>
        <Tabs searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
