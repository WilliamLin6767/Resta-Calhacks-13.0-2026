import Link from "next/link";
import { Suspense } from "react";
import AnalyzeButton from "@/components/analytics/AnalyzeButton";
import {
  ChannelDonut,
  CostBreakdownChart,
  DailyRevenueChart,
  HourChart,
  MenuScatter,
  WeekdayChart,
} from "@/components/analytics/Charts";
import MenuTable from "@/components/analytics/MenuTable";
import ChartView from "@/components/assistant/ChartView";
import ExplainButton from "@/components/assistant/ExplainButton";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import {
  MENU_CLASSES,
  PERIOD_OPTIONS,
  parseDays,
  type AiReport,
  type AiSection,
  type Digest,
  type Kpis,
  type SectionId,
} from "@/lib/analytics";
import type { ChartId } from "@/lib/assistant";
import { formatMoney } from "@/lib/format";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

export default function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  return (
    <div>
      <PageHeader title="Analytics" description="See which dishes sell and which ones make money." />
      {/* searchParams are only known at request time, so read them inside Suspense */}
      <Suspense fallback={<p className="text-sm text-gray-500">Loading analytics...</p>}>
        <AnalyticsContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AnalyticsContent({ searchParams }: { searchParams: PageProps<"/analytics">["searchParams"] }) {
  const params = await searchParams;
  const days = parseDays(Array.isArray(params.days) ? params.days[0] : params.days);

  // One call for all the numbers, plus the newest saved AI report for this period.
  const supabase = await getSupabase();
  const [digestResult, reportResult] = await Promise.all([
    supabase.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: days }),
    supabase
      .from("ai_reports")
      .select("report, model, created_at")
      .eq("restaurant_id", RESTAURANT_ID)
      .eq("period_days", days)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (digestResult.error) return <ErrorMessage message={digestResult.error.message} />;

  const digest = digestResult.data as Digest;
  const saved = reportResult.data;
  const report = (saved?.report as AiReport | undefined) ?? null;

  // Finds the AI's note for one chart, if there is a report.
  const note = (id: SectionId) => report?.sections.find((s) => s.id === id);

  return (
    <div className="space-y-6">
      <PeriodPicker days={days} period={digest.period} />

      <AiPanel report={report} createdAt={saved?.created_at ?? null} days={days} />
      {reportResult.error && <ErrorMessage message={`Could not load the saved AI report: ${reportResult.error.message}`} />}

      <ChartCard chart="kpis" title="Key numbers" note={note("kpis")}>
        {digest.kpis.cur ? (
          <KpiCards cur={digest.kpis.cur} prev={digest.kpis.prev} />
        ) : (
          <p className="text-sm text-gray-500">No orders in this period.</p>
        )}
      </ChartCard>

      <ChartCard chart="daily" title="Revenue per day" note={note("daily")}>
        <DailyRevenueChart daily={digest.daily} />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard chart="weekday" title="Average revenue by weekday" note={note("by_weekday")}>
          <WeekdayChart rows={digest.by_weekday} />
        </ChartCard>
        <ChartCard chart="hour" title="Average orders by hour" note={note("by_hour")}>
          <HourChart rows={digest.by_hour} />
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard chart="channels" title="Revenue by channel" note={note("channels")}>
          <ChannelDonut channels={digest.channels} />
        </ChartCard>
        <ChartCard chart="waterfall" title="Where the money goes" note={note("costs")}>
          <CostBreakdownChart costs={digest.costs} />
        </ChartCard>
      </div>

      <ChartCard chart="menu" title="Menu engineering" note={note("menu")}>
        <MenuScatter menu={digest.menu} thresholds={digest.menu_thresholds} />
        <ul className="my-4 grid gap-2 text-sm sm:grid-cols-2">
          {MENU_CLASSES.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
              <span>
                <span className="font-medium">{c.label}:</span> {c.meaning}
              </span>
            </li>
          ))}
        </ul>
        <MenuTable menu={digest.menu} />
      </ChartCard>
    </div>
  );
}

// 7 / 30 / 60 day links. The active one is dark.
function PeriodPicker({ days, period }: { days: number; period: Digest["period"] }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex overflow-hidden rounded border border-gray-300 bg-white text-sm">
        {PERIOD_OPTIONS.map((option) => (
          <Link
            key={option}
            href={`/analytics?days=${option}`}
            className={`px-3 py-1.5 ${option === days ? "bg-gray-900 text-white" : "hover:bg-gray-100"}`}
          >
            {option} days
          </Link>
        ))}
      </div>
      <p className="text-sm text-gray-500">
        {period.start} to {period.end}, compared with {period.previous_start} to {period.previous_end}
      </p>
      <Link
        href={`/analytics/compare?days=${days}`}
        className="ml-auto rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-500"
      >
        Compare numbers →
      </Link>
    </div>
  );
}

// ---------- AI panel ----------

const HEALTH_STYLES = {
  good: { label: "Looking good", className: "bg-green-100 text-green-800" },
  watch: { label: "Keep an eye on it", className: "bg-amber-100 text-amber-800" },
  act: { label: "Needs action", className: "bg-red-100 text-red-800" },
};

function AiPanel({ report, createdAt, days }: { report: AiReport | null; createdAt: string | null; days: number }) {
  return (
    <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">AI analysis</h2>
          {createdAt && (
            <p className="text-xs text-gray-500">Written {new Date(createdAt).toLocaleString("en-US")}</p>
          )}
        </div>
        <AnalyzeButton days={days} />
      </div>

      {!report ? (
        <p className="text-sm text-gray-500">
          No AI analysis for the last {days} days yet. Click &quot;Analyze with AI&quot; to write one.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${HEALTH_STYLES[report.health].className}`}>
              {HEALTH_STYLES[report.health].label}
            </span>
            <p className="text-lg font-medium">{report.headline}</p>
          </div>
          <ol className="space-y-3">
            {report.actions.map((action, i) => (
              <li key={i} className="rounded border border-gray-100 bg-gray-50 p-3 text-sm">
                <p className="font-medium">
                  {i + 1}. {action.title} <span className="ml-1 text-xs font-normal text-gray-500">({action.area})</span>
                </p>
                <p className="text-gray-700">{action.why}</p>
                <p className="mt-1 text-gray-500">{action.estimated_impact}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

// ---------- Chart card with the AI's note underneath ----------

const STATUS_STYLES = {
  good: { label: "Good", dot: "bg-green-500" },
  neutral: { label: "Neutral", dot: "bg-gray-400" },
  concern: { label: "Concern", dot: "bg-red-500" },
};

// `title` must match chartContext(chart).title in lib/assistant.ts, so the assistant and the page agree.
function ChartCard({ chart, title, note, children }: { chart: ChartId; title: string; note?: AiSection; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <ExplainButton target={{ chart }} title={title} />
      </div>
      <ChartView target={{ chart }} title={title}>
        {children}
      </ChartView>
      {note && (
        <div className="mt-4 border-t border-gray-100 pt-3 text-sm">
          <p className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-500">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLES[note.status].dot}`} />
            {STATUS_STYLES[note.status].label}
          </p>
          <p className="text-gray-600">{note.what_it_shows}</p>
          <p className="mt-1">{note.what_it_means}</p>
        </div>
      )}
    </section>
  );
}

// ---------- KPI cards ----------

// lowerIsBetter flips the colors: for costs, going down is good.
const KPI_CARDS: { key: keyof Kpis; label: string; format: (v: number) => string; lowerIsBetter?: boolean }[] = [
  { key: "revenue", label: "Revenue", format: formatMoney },
  { key: "orders", label: "Orders", format: (v) => v.toLocaleString("en-US") },
  { key: "avg_ticket", label: "Average ticket", format: formatMoney },
  { key: "food_cost_pct", label: "Food cost %", format: (v) => `${v}%`, lowerIsBetter: true },
  { key: "platform_fees", label: "Delivery platform fees", format: formatMoney, lowerIsBetter: true },
  { key: "est_profit", label: "Estimated profit", format: formatMoney },
];

function KpiCards({ cur, prev }: { cur: Kpis; prev?: Kpis }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {KPI_CARDS.map((kpi) => {
        const now = Number(cur[kpi.key]);
        const before = prev ? Number(prev[kpi.key]) : 0;
        const change = before ? ((now - before) / Math.abs(before)) * 100 : null;
        const good = change !== null && (kpi.lowerIsBetter ? change < 0 : change > 0);
        const color = change === null || change === 0 ? "text-gray-500" : good ? "text-green-700" : "text-red-700";

        return (
          <div key={kpi.key} className="rounded border border-gray-200 p-4">
            <p className="text-sm text-gray-500">{kpi.label}</p>
            <p className="text-2xl font-bold">{kpi.format(now)}</p>
            <p className={`text-sm ${color}`}>
              {change === null ? "No earlier data" : `${change > 0 ? "▲" : change < 0 ? "▼" : ""} ${change > 0 ? "+" : ""}${change.toFixed(1)}%`}
              <span className="text-gray-500"> vs previous period</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}
