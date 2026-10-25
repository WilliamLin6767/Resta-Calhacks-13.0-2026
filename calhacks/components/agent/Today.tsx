import { Suspense } from "react";
import Card from "@/components/Card";
import ErrorMessage from "@/components/ErrorMessage";
import { SkeletonLines } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { loadTop } from "@/lib/attention/service";
import { listCases } from "@/lib/loop/store";
import { getSupabase } from "@/lib/supabase";
import CaseList from "./CaseList";
import TodayList from "./TodayList";

// What the loop found and is waiting on the owner for. Nothing when the loop isn't set up yet.
async function OpenProposals() {
  const cases = await listCases(await getSupabase(), { statuses: ["proposed"], limit: 3 }).catch(() => []);
  if (!cases.length) return null;
  return (
    <div className="mb-4">
      <CaseList cases={cases} />
    </div>
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

// The Overview's first card: Resta's open proposals first, then the three findings worth the
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
