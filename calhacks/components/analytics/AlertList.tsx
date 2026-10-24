import Link from "next/link";
import EmptyState from "@/components/ui/EmptyState";
import { SECTION_MODULE, getModule } from "@/lib/analyticsSections";
import type { Alert } from "@/lib/insights";

const ALERT_STYLES = {
  bad: { icon: "▲", label: "Needs a look", box: "border-red-200 bg-red-50/60", badge: "bg-red-100 text-red-800" },
  info: { icon: "i", label: "Note", box: "border-gray-200 bg-white", badge: "bg-gray-100 text-gray-700" },
  good: { icon: "✓", label: "Good news", box: "border-green-200 bg-green-50/60", badge: "bg-green-100 text-green-800" },
};

// "What changed" alerts. `compact` shows titles only (for the overview);
// `showLinks` adds an "Open <module>" link to the page that explains each one.
export default function AlertList({
  alerts,
  days,
  compact = false,
  showLinks = true,
  empty = "Nothing changed enough to flag this period.",
}: {
  alerts: Alert[];
  days: number;
  compact?: boolean;
  showLinks?: boolean;
  empty?: string;
}) {
  if (alerts.length === 0) return <EmptyState title={empty} />;
  return (
    <ul className="space-y-2">
      {alerts.map((a) => {
        const style = ALERT_STYLES[a.tone];
        const moduleDef = getModule(SECTION_MODULE[a.section]);
        return (
          // Stacked (badge, title, detail, link) so the title always gets the card's full
          // width; side by side it was squeezed into a thin column when the card is narrow.
          <li key={a.id} className={`rounded-lg border p-3 ${style.box}`}>
            <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${style.badge}`}>
              <span aria-hidden="true">{style.icon} </span>
              {style.label}
            </span>
            <p className="mt-1.5 text-sm font-medium text-gray-900">{a.title}</p>
            {!compact && a.detail && <p className="mt-1 text-sm text-gray-600">{a.detail}</p>}
            {showLinks && (
              <Link
                href={`/analytics/${moduleDef.id}?days=${days}`}
                className="mt-2 inline-block text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline"
              >
                Open {moduleDef.title} →
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
