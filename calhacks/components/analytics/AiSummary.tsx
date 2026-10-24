import Link from "next/link";
import AnalyzeButton from "@/components/analytics/AnalyzeButton";
import type { AiReport } from "@/lib/analytics";
import { ACTION_AREA_MODULE, getModule } from "@/lib/analyticsSections";

export const HEALTH_STYLES = {
  good: { label: "Looking good", className: "bg-green-100 text-green-800" },
  watch: { label: "Keep an eye on it", className: "bg-amber-100 text-amber-800" },
  act: { label: "Needs action", className: "bg-red-100 text-red-800" },
};

export function HealthBadge({ health }: { health: AiReport["health"] }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${HEALTH_STYLES[health].className}`}>{HEALTH_STYLES[health].label}</span>
  );
}

// Shown when the numbers have changed since the report was written.
export function StaleBadge() {
  return (
    <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset">
      Out of date: the numbers changed since this was written
    </span>
  );
}

// The small AI summary at the top of the Analytics overview: health, one headline,
// the most valuable action, and a link to the full report.
export default function AiSummary({
  report,
  stale,
  days,
}: {
  report: AiReport | null;
  stale: boolean;
  days: number;
}) {
  if (!report) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-gray-300 bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">✦ AI summary</p>
          <p className="text-sm text-gray-500">Get a plain-language read of these numbers and what to do first. Takes about 30 seconds.</p>
        </div>
        <AnalyzeButton days={days} />
      </section>
    );
  }

  const top = report.actions[0];
  return (
    <section className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-900">✦ AI summary</p>
        <HealthBadge health={report.health} />
        {stale && <StaleBadge />}
      </div>
      <p className="mt-2 text-base font-medium text-gray-900">{report.headline}</p>
      {top && (
        <p className="mt-2 text-sm text-gray-700">
          <span className="font-medium">Do first:</span> {top.title}{" "}
          <Link
            href={`/analytics/${ACTION_AREA_MODULE[top.area]}?days=${days}`}
            className="whitespace-nowrap text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
          >
            ({getModule(ACTION_AREA_MODULE[top.area]).title})
          </Link>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link
          href={`/analytics/ai?days=${days}`}
          className="text-sm font-medium text-gray-700 hover:text-gray-900 hover:underline"
        >
          See the full analysis ({report.actions.length} actions) →
        </Link>
        {stale && <AnalyzeButton days={days} />}
      </div>
    </section>
  );
}
