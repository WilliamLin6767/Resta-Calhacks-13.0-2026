import { Suspense } from "react";
import { HealthBadge } from "@/components/analytics/AiSummary";
import ErrorMessage from "@/components/ErrorMessage";
import { NessieBadge } from "@/components/NessieBrand";
import AiThinking from "@/components/ui/AiThinking";
import Fold from "@/components/ui/Fold";
import LiveValue from "@/components/ui/LiveValue";
import { Skeleton } from "@/components/ui/Skeleton";
import { loadMoney, type Money } from "@/lib/bank/cashPlan";
import type { Forecast } from "@/lib/bank/forecast";
import { moneyPlan } from "@/lib/bank/moneyPlan";
import { formatMoney, formatWholeMoney } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { MoveToSavings, UndoMove } from "./BankActions";

function day(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// Daily balance for the next 14 days, with the reserve as a dashed line and the lowest day marked
function ForecastChart({ f }: { f: Forecast }) {
  const W = 640, H = 150, pad = { l: 8, r: 8, t: 12, b: 22 };
  const values = [...f.days.map((d) => d.balance), f.reserve, 0];
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (f.days.length - 1);
  const y = (v: number) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo || 1);
  const line = f.days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`).join(" ");
  const low = f.days.findIndex((d) => d.date === f.lowest.date);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
      aria-label={`Balance over the next ${f.days.length} days. Lowest ${formatWholeMoney(f.lowest.balance)} on ${day(f.lowest.date)}; reserve ${formatWholeMoney(f.reserve)}.`}>
      <line x1={pad.l} x2={W - pad.r} y1={y(f.reserve)} y2={y(f.reserve)} stroke="#ef4444" strokeDasharray="4 4" strokeWidth="1" />
      <text x={W - pad.r} y={y(f.reserve) - 4} textAnchor="end" fontSize="11" fill="#ef4444">Reserve {formatWholeMoney(f.reserve)}</text>
      <path d={`${line} L${x(f.days.length - 1)},${y(lo)} L${x(0)},${y(lo)} Z`} fill="currentColor" className="text-brand-100 opacity-60 dark:text-brand-500 dark:opacity-30" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-600" />
      <circle cx={x(low)} cy={y(f.lowest.balance)} r="4" fill={f.lowest.balance < f.reserve ? "#dc2626" : "currentColor"} className="text-brand-700" />
      {f.days.map((d, i) => (i % 2 === 0 ? (
        <text key={d.date} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : "middle"} fontSize="10" fill="var(--chart-axis)">{day(d.date).split(", ")[1]}</text>
      ) : null))}
    </svg>
  );
}

function Plan({ money }: { money: Money }) {
  return (
    <Suspense fallback={<AiThinking label="Writing your money plan..." />}>
      <PlanText money={money} />
    </Suspense>
  );
}

async function PlanText({ money }: { money: Money }) {
  let plan;
  try {
    plan = await moneyPlan(await getSupabase(), money);
  } catch (err) {
    return <p className="text-sm text-gray-500">No AI money plan right now ({err instanceof Error ? err.message : "unavailable"}). The numbers below are still up to date.</p>;
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-900">✦ AI money plan</p>
        <HealthBadge health={plan.status} />
      </div>
      <p className="mt-1.5 text-base font-medium text-gray-900">{plan.headline}</p>
      {plan.steps.length > 0 && (
        <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm text-gray-700">
          {plan.steps.map((s) => <li key={s.title}><span className="font-medium">{s.title}:</span> {s.why}</li>)}
        </ol>
      )}
      <p className="mt-2 text-xs text-gray-500">Written by AI from the numbers below. Cash management, not investment advice: nothing moves unless you press a button.</p>
    </div>
  );
}

function Savings({ money }: { money: Money }) {
  const { move, bank, ready, forecast } = money;
  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <h3 className="font-semibold">Move spare cash to savings</h3>
      <p className="mt-0.5 text-xs text-gray-500">Each move is a transfer between your Capital One Nessie accounts.</p>
      {!ready && <p className="mt-1 text-sm text-gray-600">Run supabase/14_cash.sql in Supabase to turn this on.</p>}
      {ready && move.kind === "now" && (
        <>
          <p className="mt-1 mb-3 text-sm text-gray-600">
            Your balance stays above your {formatWholeMoney(forecast.reserve)} reserve every day for the next two weeks even after moving{" "}
            <span className="font-semibold text-gray-900">{formatWholeMoney(move.amount)}</span>. The lowest day would be {formatWholeMoney(move.lowest_after)}.
            We keep a 20% cushion in case the estimate is off.
          </p>
          <MoveToSavings suggested={move.amount} />
        </>
      )}
      {ready && move.kind === "later" && (
        <p className="mt-1 text-sm text-gray-600">
          Not today: cash gets close to your reserve before the next payouts. After they land on {day(move.date)}, about{" "}
          <span className="font-semibold text-gray-900">{formatWholeMoney(move.amount)}</span> can go to savings and stay there for the rest of the two weeks.
        </p>
      )}
      {ready && move.kind === "none" && <p className="mt-1 text-sm text-gray-600">Nothing spare to move: keep this cash in the account for bills and orders.</p>}
      {ready && (bank.savings ?? 0) > 0 && (
        <p className="mt-3 text-sm text-gray-600">
          In savings: <span className="font-semibold tabular-nums text-gray-900"><LiveValue value={formatMoney(bank.savings)} /></span> · <UndoMove />
        </p>
      )}
    </div>
  );
}

function Budget({ money }: { money: Money }) {
  const b = money.budget;
  if (!b) return <div className="rounded-xl border border-gray-100 p-4 text-sm text-gray-500">Food budget unavailable (the sales numbers couldn&apos;t be loaded).</div>;
  const over = b.left < 0;
  const fill = Math.min(100, (100 * b.used) / (b.budget || 1));
  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <h3 className="font-semibold">Food budget, last {b.days} days</h3>
      <p className="mt-1 text-sm text-gray-600">
        Food for what you sold cost {formatWholeMoney(b.used)}: <span className={`font-semibold ${over ? "text-red-600" : "text-gray-900"}`}>{b.pct}%</span> of{" "}
        {formatWholeMoney(b.sales)} in sales. Your target is {b.target_pct}% ({formatWholeMoney(b.budget)}).
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100" role="meter" aria-valuemin={0} aria-valuemax={b.budget} aria-valuenow={b.used} aria-label="Food used against the budget">
        <div className={`h-full ${over ? "bg-red-500" : "bg-brand-600"}`} style={{ width: `${fill}%` }} />
      </div>
      <p className={`mt-1 text-xs ${over ? "text-red-600" : "text-gray-500"}`}>
        {over ? `${formatWholeMoney(-b.left)} over budget` : `${formatWholeMoney(b.left)} under budget`}
      </p>
      {b.top.length > 0 && (
        <>
          <p className="mt-3 text-sm font-medium text-gray-700">Where most of the food money goes</p>
          <ul className="mt-1 grid gap-0.5 text-sm text-gray-600">
            {b.top.map((t) => <li key={t.name} className="flex justify-between gap-2"><span>{t.name}</span><span className="tabular-nums">{formatWholeMoney(t.food_cost)} · {t.share}%</span></li>)}
          </ul>
        </>
      )}
      <p className="mt-2 text-xs text-gray-500">From recipes and the prices you paid, like the Analytics tab.</p>
    </div>
  );
}

async function CashPlanBody() {
  let money;
  try {
    money = await loadMoney(await getSupabase());
  } catch (err) {
    return <ErrorMessage message={`Cash plan: ${err instanceof Error ? err.message : String(err)}`} />;
  }
  if (!money) return null; // no bank connected: the bank section above offers to connect one
  const f = money.forecast;
  const big = f.days.filter((d) => d.events.length);
  return (
    <section className="mb-8 rounded-2xl border border-brand-100 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Cash plan, next 14 days</h2>
        <NessieBadge label="Balance from Capital One Nessie" />
      </div>
      <p className="mt-1 text-xs text-gray-500">Supplies account: delivery payouts in, supplier bills out · a forecast from your recent payouts and bills</p>
      <div className="mt-3 border-b border-gray-100 pb-4"><Plan money={money} /></div>

      {f.first_below && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          Cash is forecast to drop below your {formatWholeMoney(f.reserve)} reserve on {day(f.first_below)}. Hold off on orders that can wait, or chase money the apps owe you.
        </p>
      )}
      <div className="mt-4">
        <Fold summary={<span className="text-gray-700">The 14-day forecast, savings and food budget</span>}>
          <div className="grid grid-cols-2 gap-3 px-1 md:grid-cols-4">
            <div>
              <p className={`text-xl font-semibold tabular-nums ${f.first_below ? "text-red-600" : ""}`}>{formatWholeMoney(f.lowest.balance)}</p>
              <p className="text-sm text-gray-600">Lowest, on {day(f.lowest.date)}</p>
            </div>
            <div><p className="text-xl font-semibold tabular-nums">{formatWholeMoney(f.days[f.days.length - 1].balance)}</p><p className="text-sm text-gray-600">In two weeks</p></div>
            <div><p className="text-xl font-semibold tabular-nums text-green-700">+ {formatWholeMoney(f.money_in)}</p><p className="text-sm text-gray-600">Payouts expected</p></div>
            <div><p className="text-xl font-semibold tabular-nums">− {formatWholeMoney(f.money_out)}</p><p className="text-sm text-gray-600">Bills, orders, usual buying</p></div>
          </div>
          <div className="mt-3"><ForecastChart f={f} /></div>
          <details className="mt-1">
            <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">How this is worked out</summary>
            <div className="mt-2 text-sm text-gray-600">
              <p>
                Starts from the balance now. Each app pays a week after its last payout, at the average of its last 4. Bills come out on their due date
                (overdue ones today), approved orders on their delivery date, and {formatMoney(f.daily_spend)} a day of usual supplier buying on top, from the last 6 weeks of invoices.
              </p>
              <ul className="mt-2 grid gap-0.5">
                {big.map((d) => (
                  <li key={d.date}><span className="font-medium">{day(d.date)}:</span> {d.events.map((e) => `${e.label} ${e.amount > 0 ? "+" : "−"}${formatWholeMoney(Math.abs(e.amount))}`).join(", ")}</li>
                ))}
              </ul>
            </div>
          </details>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Savings money={money} />
            <Budget money={money} />
          </div>
        </Fold>
      </div>
    </section>
  );
}

// The 14-day cash forecast, savings suggestion, food budget and AI money plan
export default function CashPlan() {
  return (
    // Roughly the cash plan's height, so the page below doesn't jump when it arrives
    <Suspense fallback={<Skeleton className="mb-8 h-[260px] rounded-2xl" />}>
      <CashPlanBody />
    </Suspense>
  );
}
