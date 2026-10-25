import Link from "next/link";
import { Suspense } from "react";
import AttentionBar from "@/components/attention/AttentionBar";
import PageHeader from "@/components/PageHeader";
import ErrorMessage from "@/components/ErrorMessage";
import EmptyState from "@/components/ui/EmptyState";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { parsePrepDate } from "@/lib/prep/http";
import { addDays, loadPrep, todayLocal } from "@/lib/prep/service";
import { getSupabase } from "@/lib/supabase";
import EmailInbox from "../invoices/EmailInbox";
import PrepPlanner from "./PrepPlanner";
import LiveRefresh from "@/components/live/LiveRefresh";

async function Prep({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const supabase = await getSupabase(); // before reading the date, so "tomorrow" is worked out per request
  const date = parsePrepDate((await searchParams).date) ?? addDays(todayLocal(), 1);
  let prep;
  try {
    prep = await loadPrep(supabase, date);
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  return (
    <>
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Pick a day">
        {prep.days.map((d) => (
          <Link
            key={d.date}
            href={`/prep?date=${d.date}`}
            className={`lift rounded-md border px-3 py-1.5 text-sm ${
              d.date === date ? "border-brand-600 bg-brand-600 text-white" : d.closed ? "border-gray-200 text-gray-400" : "border-gray-300 bg-white hover:bg-gray-100"
            }`}
          >
            {d.weekday.slice(0, 3)} {Number(d.date.slice(8))}
            {d.closed && " · closed"}
          </Link>
        ))}
      </nav>
      <h2 className="mb-1 text-xl font-semibold">
        {prep.forecast.weekday}, {new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}
      </h2>
      {prep.forecast.closed ? (
        <EmptyState title={`Closed on ${prep.forecast.weekday}s. Nothing to prep.`} hint={`There were no sales on recent ${prep.forecast.weekday}s.`} icon="clipboard" />
      ) : (
        <PrepPlanner key={date} forecast={prep.forecast} recipes={prep.recipes} stock={prep.stock} sources={prep.sources} />
      )}
    </>
  );
}

// The day picker, the day's title and the prep table, while they load.
function PrepSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading</span>
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-[34px] w-20" />
        ))}
      </div>
      <Skeleton className="mb-3 h-7 w-64" />
      <Skeleton className="mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="mb-8 h-36 rounded-2xl" />
      <SkeletonTable rows={8} cols={5} />
    </div>
  );
}

export default function PrepPage({ searchParams }: PageProps<"/prep">) {
  return (
    <div>
      <PageHeader title="Prep" description="How many of each dish to expect, what to prep, and what you'll run short of. The forecast is plain math from your past sales; the AI only adjusts it when you tell it something about the day." />
      <LiveRefresh topics={["prep", "attention"]} />
      <AttentionBar tab="prep" />
      {/* Catering requests by email: accepted ones are what the kitchen preps for */}
      <Suspense fallback={<Skeleton className="mb-8 h-32 rounded-2xl" />}>
        <EmailInbox kind="catering" />
      </Suspense>
      <Suspense fallback={<PrepSkeleton />}>
        <Prep searchParams={searchParams as Promise<{ date?: string }>} />
      </Suspense>
    </div>
  );
}
