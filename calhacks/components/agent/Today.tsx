import Link from "next/link";
import { Suspense } from "react";
import Card from "@/components/Card";
import ErrorMessage from "@/components/ErrorMessage";
import { SkeletonLines } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { openProposals } from "@/lib/agent/actions";
import { loadTop } from "@/lib/attention/service";
import { listCases } from "@/lib/loop/store";
import { getSupabase } from "@/lib/supabase";
import TodayList from "./TodayList";

// How many approvals are waiting. They're decided on the Actions page only, so this is a link.
async function OpenProposals() {
  const [cases, waiting] = await Promise.all([
    listCases(await getSupabase(), { statuses: ["proposed"], limit: 50 }).catch(() => []),
    openProposals(await getSupabase(), 50),
  ]);
  if (!cases.length && !waiting.length) return null;
  const n = waiting.length;
  return (
    <Link href="/actions" className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-4 py-3 text-sm hover:bg-brand-100">
      <span className="font-medium text-gray-900">
        {n ? `${n} approval${n === 1 ? "" : "s"} waiting for you` : `Resta is working on ${cases.length} case${cases.length === 1 ? "" : "s"}`}
      </span>
      <span className="font-medium text-brand-700">Open Actions</span>
    </Link>
  );
}

async function TopFindings() {
  let items;
  try {
    items = await loadTop(await getSupabase(), 3);
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : "Could not work out today's list."} />;
  }
  if (!items.length) return <EmptyState title="Nothing worth your time right now." icon="check" />;
  return <TodayList items={items} />;
}

// The Overview's first card: how many approvals wait in Actions, then the three findings worth the
// most this week, in dollars worked out in code (lib/attention/impact.ts), each with its basis.
export default function Today() {
  return (
    <Card title="Today" className="mb-6">
      <Suspense fallback={null}>
        <OpenProposals />
      </Suspense>
      <Suspense fallback={<SkeletonLines lines={3} />}>
        <TopFindings />
      </Suspense>
    </Card>
  );
}
