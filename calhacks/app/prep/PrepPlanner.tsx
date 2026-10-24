"use client";

import { useState } from "react";
import OrderPlan from "@/components/OrderPlan";
import AiThinking from "@/components/ui/AiThinking";
import Fold from "@/components/ui/Fold";
import LiveValue from "@/components/ui/LiveValue";
import { table, tableWrap, td, tdNum, th, thead, thNum, tr } from "@/components/ui/table";
import { useAction } from "@/components/useAction";
import { adjustForecast, clampFactor, prepNeeds, type Forecast, type RecipeRow, type StockRow } from "@/lib/prep/forecast";
import type { Source } from "@/lib/prep/service";

type Adjustment = { summary: string; adjustments: { menu_item_id: number; factor: number; reason: string }[] };

const CONFIDENCE: Record<string, string> = {
  high: "steady",
  medium: "varies",
  low: "hard to call",
};

function shortDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function PrepPlanner({
  forecast, recipes, stock, sources,
}: { forecast: Forecast; recipes: RecipeRow[]; stock: StockRow[]; sources: Record<number, Source> }) {
  const [note, setNote] = useState("");
  const [adjustment, setAdjustment] = useState<Adjustment | null>(null);
  const ai = useAction();

  const factors: Record<number, number> = {};
  for (const a of adjustment?.adjustments ?? []) factors[a.menu_item_id] = clampFactor(a.factor);
  const adjusted = adjustForecast(forecast, factors);
  const needs = prepNeeds(adjusted, recipes, stock);
  const short = needs.filter((n) => n.short > 0 && !n.tight);
  const categories = [...new Set(needs.map((n) => n.category))];

  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-600">
        Based on the last {forecast.days_used.length} {forecast.weekday}s ({forecast.days_used.map(shortDate).join(", ")}). Recent weeks count more.
      </p>

      <section className="rounded-2xl border border-brand-100 bg-white p-4">
        <label htmlFor="note" className="font-medium">Anything different about {forecast.weekday}?</label>
        <p className="text-sm text-gray-600">An event nearby, the weather, a holiday, a catering order. The AI adjusts the dishes it affects; you see every change.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Cal home game, crowds after 5pm"
            maxLength={500}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            disabled={ai.loading || !note.trim()}
            onClick={() =>
              ai.run("/api/prep/adjust", { date: forecast.date, note }, (data) => setAdjustment(data as unknown as Adjustment), {
                success: `Forecast adjusted for ${forecast.weekday}`,
              })
            }
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {ai.loading ? "Thinking..." : "Adjust forecast"}
          </button>
        </div>
        {ai.loading && <AiThinking label="Adjusting the forecast..." className="mt-2" />}
        {ai.error && <p className="mt-2 text-sm text-red-600">{ai.error}</p>}
        {adjustment && (
          <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
            <p>
              <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-gray-500">AI</span>
              {adjustment.summary}
            </p>
            {adjustment.adjustments.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-gray-700">
                {adjustment.adjustments.map((a) => {
                  const dish = forecast.dishes.find((d) => d.id === a.menu_item_id);
                  const f = clampFactor(a.factor);
                  return (
                    <li key={a.menu_item_id}>
                      {dish?.name}: {f >= 1 ? "+" : ""}{Math.round((f - 1) * 100)}% ({a.reason})
                    </li>
                  );
                })}
              </ul>
            )}
            <button onClick={() => setAdjustment(null)} className="mt-2 text-xs text-gray-600 underline">Undo the AI changes</button>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Prep list</h2>
            <p className="text-sm text-gray-600">
              Ingredients for the expected number of dishes. &quot;Busy day&quot; = as busy as the busiest of those {forecast.weekday}s.
            </p>
          </div>
          {short.length > 0 && (
            // key: a new AI adjustment starts a fresh plan
            <OrderPlan
              key={JSON.stringify(factors)}
              request={{ kind: "prep", date: forecast.date, factors }}
              label={`Plan orders for ${short.length} short ${short.length === 1 ? "item" : "items"}`}
            />
          )}
        </div>
        <div className={tableWrap}>
          <table className={table}>
            <thead className={thead}>
              <tr>
                <th className={th}>Ingredient</th>
                <th className={thNum}>Prep</th>
                <th className={thNum}>Busy day</th>
                <th className={thNum}>On hand that morning</th>
                <th className={th}>Stock</th>
              </tr>
            </thead>
            {categories.map((cat) => (
              <tbody key={cat}>
                <tr className="border-y border-gray-200 bg-gray-50/60">
                  <td colSpan={5} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{cat}</td>
                </tr>
                {needs.filter((n) => n.category === cat).map((n) => {
                  const src = sources[n.ingredient_id];
                  const late = src && src.earliest_delivery > forecast.date;
                  return (
                    <tr key={n.ingredient_id} className={tr}>
                      <td className={td}>{n.name}</td>
                      {/* Flashes when an AI adjustment changes it */}
                      <td className={`${tdNum} font-medium`}><LiveValue value={`${fmt(n.needed)} ${n.unit}`} /></td>
                      <td className={`${tdNum} text-gray-500`}><LiveValue value={fmt(n.needed_busy)} /></td>
                      <td className={tdNum}>
                        {fmt(n.on_hand)}
                        {n.on_order > 0 && <span className="text-gray-500"> + {fmt(n.on_order)} on order</span>}
                      </td>
                      <td className={td}>
                        {n.tight ? (
                          <span className="text-amber-700">Tight: enough unless it&apos;s a busy day</span>
                        ) : n.short > 0 ? (
                          <span className="text-red-700">
                            Short {fmt(n.short)} {n.unit}
                            {src && <span className="text-gray-600"> · {src.supplier}{late ? `, earliest ${shortDate(src.earliest_delivery)}` : ""}</span>}
                          </span>
                        ) : (
                          <span className="text-green-700">Enough</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Dishes expected</h2>
        <Fold summary={<span className="text-gray-700">About {adjusted.dishes.reduce((n, d) => n + d.expected, 0)} plates across {adjusted.dishes.length} dishes</span>}>
          <div className={tableWrap}>
            <table className={table}>
              <thead className={thead}>
                <tr>
                  <th className={th}>Dish</th>
                  <th className={thNum}>Expected</th>
                  <th className={thNum}>Range</th>
                  <th className={thNum}>Past {forecast.weekday}s, oldest first</th>
                  <th className={th}>Forecast</th>
                </tr>
              </thead>
              <tbody>
                {adjusted.dishes.map((d) => (
                  <tr key={d.id} className={tr}>
                    <td className={td}>{d.name}</td>
                    <td className={`${tdNum} font-medium`}>
                      <LiveValue value={String(d.expected)} />
                      {factors[d.id] && <span className="ml-1 text-xs text-gray-500">(AI)</span>}
                    </td>
                    <td className={`${tdNum} text-gray-500`}>{d.low}–{d.high}</td>
                    <td className={`${tdNum} text-gray-500`}>{d.history.join(", ")}</td>
                    <td className={`${td} text-gray-600`}>{CONFIDENCE[d.confidence]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      </section>
    </div>
  );
}
