import Link from "next/link";
import { PERIOD_OPTIONS, type Digest } from "@/lib/analytics";

// 7 / 30 / 60 day links. `basePath` keeps you on the same page (overview or a module).
export default function PeriodPicker({
  days,
  period,
  basePath = "/analytics",
}: {
  days: number;
  period: Digest["period"];
  basePath?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex overflow-hidden rounded-md border border-gray-300 bg-white text-sm">
        {PERIOD_OPTIONS.map((option) => (
          <Link
            key={option}
            href={`${basePath}?days=${option}`}
            aria-current={option === days ? "true" : undefined}
            className={`px-3 py-1.5 ${option === days ? "bg-brand-600 text-white" : "hover:bg-gray-100"}`}
          >
            {option} days
          </Link>
        ))}
      </div>
      <p className="text-sm text-gray-500">
        {period.start} to {period.end}
        <span className="hidden sm:inline">, compared with {period.previous_start} to {period.previous_end}</span>
      </p>
    </div>
  );
}
