import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StaleBadge } from "@/components/analytics/AiSummary";
import AlertList from "@/components/analytics/AlertList";
import AskChips from "@/components/analytics/AskChips";
import ChartCard from "@/components/analytics/ChartCard";
import {
  ChannelDonut,
  CostBreakdownChart,
  DailyRevenueChart,
  HourChart,
  MenuScatter,
  WeekdayChart,
} from "@/components/analytics/Charts";
import { PrimeCostBar, ProfitSteps } from "@/components/analytics/KpiVisuals";
import MenuTable from "@/components/analytics/MenuTable";
import PeriodPicker from "@/components/analytics/PeriodPicker";
import ErrorMessage from "@/components/ErrorMessage";
import SimpleTable from "@/components/SimpleTable";
import { MENU_CLASSES, parseDays, type AiReport, type Digest, type SectionId } from "@/lib/analytics";
import {
  MODULES,
  MODULE_IDS,
  MODULE_QUESTIONS,
  alertsForModule,
  getModule,
  isModuleId,
  type ModuleId,
} from "@/lib/analyticsSections";
import { formatMoney, formatWholeMoney } from "@/lib/format";
import { KPI_DEFS, buildAlerts, buildWaterfall, channelName, kpiChange, type KpiDef } from "@/lib/insights";
import { formatKpiValue } from "@/lib/kpiDetails";
import { loadAnalytics } from "../data";

// One page per area of the business: /analytics/sales, /analytics/menu, ...

export function generateStaticParams() {
  return MODULE_IDS.map((module) => ({ module }));
}

export async function generateMetadata({ params }: PageProps<"/analytics/[module]">): Promise<Metadata> {
  const { module } = await params;
  return { title: isModuleId(module) ? `${getModule(module).title} · Analytics` : "Analytics" };
}

export default async function ModulePage({ params, searchParams }: PageProps<"/analytics/[module]">) {
  const { module } = await params;
  if (!isModuleId(module)) notFound();
  const def = getModule(module);

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-gray-500">
        <Link href="/analytics" className="hover:text-gray-900 hover:underline">
          Analytics
        </Link>{" "}
        / <span className="text-gray-900">{def.title}</span>
      </nav>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{def.title}</h1>
        <p className="mt-1 text-sm text-gray-600">{def.question}</p>
      </header>
      {/* searchParams are only known at request time, so read them inside Suspense */}
      <Suspense
        fallback={
          <div className="h-[32rem] animate-pulse rounded-xl bg-gray-100" aria-busy="true">
            <span className="sr-only">Loading...</span>
          </div>
        }
      >
        <ModuleContent id={module} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ModuleContent({ id, searchParams }: { id: ModuleId; searchParams: PageProps<"/analytics/[module]">["searchParams"] }) {
  const params = await searchParams;
  const days = parseDays(Array.isArray(params.days) ? params.days[0] : params.days);
  const loaded = await loadAnalytics(days);
  if ("error" in loaded) return <ErrorMessage message={loaded.error} />;
  const { digest, report, stale } = loaded;

  const alerts = alertsForModule(buildAlerts(digest), id);
  const note = (section: SectionId) => report?.sections.find((s) => s.id === section);

  return (
    <div className="space-y-6">
      <ModuleTabs current={id} days={days} />
      <PeriodPicker days={days} period={digest.period} basePath={`/analytics/${id}`} />

      {/* What changed in this area (Busy times has no alert rules) */}
      {id !== "busy" && (
        <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">What changed here</h2>
          <AlertList alerts={alerts} days={days} showLinks={false} empty="Nothing in this area changed enough to flag." />
        </section>
      )}

      {digest.kpis.cur ? <ModuleCharts id={id} digest={digest} note={note} /> : <p className="text-sm text-gray-500">No orders in this period.</p>}

      <AskPanel id={id} report={report} stale={stale} days={days} />
    </div>
  );
}

// A row of the six modules, so the owner can move between areas without going back.
function ModuleTabs({ current, days }: { current: ModuleId; days: number }) {
  return (
    <nav aria-label="Analytics areas" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {MODULES.map((m) => (
          <li key={m.id}>
            <Link
              href={`/analytics/${m.id}?days=${days}`}
              aria-current={m.id === current ? "page" : undefined}
              className={`block rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${
                m.id === current ? "bg-gray-900 font-medium text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              {m.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// The assistant, set up for this area: one-tap questions, and a pointer to the AI report.
function AskPanel({ id, report, stale, days }: { id: ModuleId; report: AiReport | null; stale: boolean; days: number }) {
  return (
    <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-900">✦ Ask about {getModule(id).title.toLowerCase()}</h2>
        {report && stale && <StaleBadge />}
      </div>
      <AskChips questions={MODULE_QUESTIONS[id]} />
      <p className="mt-3 text-xs text-gray-500">
        {report ? (
          <>
            The AI&apos;s notes are under each chart.{" "}
            <Link href={`/analytics/ai?days=${days}`} className="underline hover:text-gray-900">
              See the full AI analysis
            </Link>
            .
          </>
        ) : (
          <>
            No AI analysis yet.{" "}
            <Link href={`/analytics/ai?days=${days}`} className="underline hover:text-gray-900">
              Run it from the AI analysis page
            </Link>{" "}
            to get notes on every chart.
          </>
        )}
      </p>
    </section>
  );
}

// ---------- The charts for each module ----------

type NoteFn = (section: SectionId) => AiReport["sections"][number] | undefined;

const ORDERS_DEF: KpiDef = { key: "orders", label: "Orders", kind: "count", hint: "Number of tickets" };
const TICKET_DEF: KpiDef = { key: "avg_ticket", label: "Average ticket", kind: "money", hint: "Revenue per order" };

function ModuleCharts({ id, digest, note }: { id: ModuleId; digest: Digest; note: NoteFn }) {
  const cur = digest.kpis.cur!;
  switch (id) {
    case "sales": {
      const defs = [KPI_DEFS[0], KPI_DEFS[1], ORDERS_DEF, TICKET_DEF];
      return (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {defs.map((d) => {
              const change = kpiChange(d, cur, digest.kpis.prev);
              return (
                <div key={d.key} className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-gray-500">{d.label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {d.key === "avg_ticket" ? formatMoney(cur.avg_ticket) : formatKpiValue(d, cur)}
                  </p>
                  <p
                    className={`mt-1 text-xs ${
                      !change ? "text-gray-500" : change.tone === "good" ? "text-green-700" : change.tone === "bad" ? "text-red-700" : "text-gray-500"
                    }`}
                  >
                    {change ? `${change.value > 0 ? "▲ +" : change.value < 0 ? "▼ " : ""}${change.value}% vs previous` : "No earlier period"}
                  </p>
                </div>
              );
            })}
          </div>
          <ChartCard chart="daily" title="Revenue per day" note={note("daily") ?? note("kpis")}>
            <DailyRevenueChart daily={digest.daily} />
          </ChartCard>
        </>
      );
    }

    case "busy": {
      const fewDays = digest.by_weekday.some((w) => w.days < 3);
      return (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard chart="weekday" title="Average revenue by weekday" note={note("by_weekday")}>
              <WeekdayChart rows={digest.by_weekday} />
              {fewDays && (
                <p className="mt-2 text-xs text-gray-500">
                  Some weekdays have only 1 or 2 open days in this period, so treat their averages as a rough guide.
                </p>
              )}
            </ChartCard>
            <ChartCard chart="hour" title="Average orders by hour" note={note("by_hour")}>
              <HourChart rows={digest.by_hour} />
            </ChartCard>
          </div>
        </>
      );
    }

    case "channels":
      return (
        <ChartCard chart="channels" title="Revenue by channel" note={note("channels")}>
          <ChannelDonut channels={digest.channels} />
          <div className="mt-4">
            <SimpleTable
              columns={[
                { key: "name", label: "Channel" },
                { key: "revenue", label: "Revenue" },
                { key: "fees", label: "Fees" },
                { key: "kept", label: "Kept after fees" },
                { key: "change", label: "Kept vs previous" },
              ]}
              rows={digest.channels.map((c) => ({
                name: channelName(c.channel),
                revenue: formatWholeMoney(c.revenue),
                fees: c.platform_fees > 0 ? `${formatWholeMoney(c.platform_fees)} (${c.fee_rate_pct}%)` : "-",
                kept: formatWholeMoney(c.net_revenue),
                change: c.net_revenue_change_pct === null ? "-" : `${c.net_revenue_change_pct > 0 ? "+" : ""}${c.net_revenue_change_pct}%`,
              }))}
            />
          </div>
        </ChartCard>
      );

    case "costs":
      return (
        <ChartCard chart="waterfall" title="Where the money goes" note={note("costs")}>
          <CostBreakdownChart costs={digest.costs} />
          <div className="mt-6 grid gap-6 border-t border-gray-100 pt-5 lg:grid-cols-2">
            <ProfitSteps steps={buildWaterfall(digest)} />
            <PrimeCostBar kpis={cur} />
          </div>
        </ChartCard>
      );

    case "menu":
      return (
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
      );

    case "suppliers":
      return (
        <ChartCard chart="price_changes" title="Supplier price changes" note={note("price_changes")}>
          <SimpleTable
            columns={[
              { key: "ingredient", label: "Ingredient" },
              { key: "supplier", label: "Supplier" },
              { key: "since", label: "Since" },
              { key: "price", label: "Price per pack" },
              { key: "change", label: "Change" },
              { key: "impact", label: "Extra cost this period" },
              { key: "cheapest", label: "Cheaper option" },
              { key: "dishes", label: "Used in" },
            ]}
            rows={digest.price_changes.map((p) => ({
              ingredient: p.ingredient,
              supplier: p.supplier,
              since: p.since,
              price: `${formatMoney(p.previous_price)} → ${formatMoney(p.current_price)}`,
              change: `${p.change_pct > 0 ? "+" : ""}${p.change_pct}%`,
              impact: p.est_period_impact == null ? "-" : formatMoney(p.est_period_impact),
              cheapest: p.cheapest_supplier ?? "-",
              dishes: p.dishes.join(", "),
            }))}
          />
        </ChartCard>
      );
  }
}
