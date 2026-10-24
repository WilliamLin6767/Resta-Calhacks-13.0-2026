import Link from "next/link";
import { Suspense } from "react";
import PageHeader from "@/components/PageHeader";
import ErrorMessage from "@/components/ErrorMessage";
import { parsePrepDate } from "@/lib/prep/http";
import { addDays, loadPrep, todayLocal } from "@/lib/prep/service";
import { getSupabase } from "@/lib/supabase";
import PrepPlanner from "./PrepPlanner";

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
            className={`rounded-md border px-3 py-1.5 text-sm ${
              d.date === date ? "border-gray-900 bg-gray-900 text-white" : d.closed ? "border-gray-200 text-gray-400" : "border-gray-300 bg-white hover:bg-gray-100"
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
        <p className="text-gray-600">Closed: there were no sales on recent {prep.forecast.weekday}s. Nothing to prep.</p>
      ) : (
        <PrepPlanner key={date} forecast={prep.forecast} recipes={prep.recipes} stock={prep.stock} sources={prep.sources} />
      )}
    </>
  );
}

export default function PrepPage({ searchParams }: PageProps<"/prep">) {
  return (
    <div>
      <PageHeader title="Prep" description="How many of each dish to expect, what to prep, and what you'll run short of. The forecast is plain math from your past sales; the AI only adjusts it when you tell it something about the day." />
      <Suspense fallback={<p className="text-sm text-gray-400">Loading...</p>}>
        <Prep searchParams={searchParams as Promise<{ date?: string }>} />
      </Suspense>
    </div>
  );
}
