"use client";

// The KPI cards at the top of Analytics. Click a card to open its details underneath:
// this period vs last, how it's worked out, a small picture, and a shortcut to ask the AI.
// The details are built on the server and passed in; this component only opens and closes them.

import { useId, useState } from "react";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import type { KpiChange } from "@/lib/insights";
import Link from "next/link";
import type { KpiDetail } from "@/lib/kpiDetails";

export type KpiCardData = {
  key: string;
  label: string;
  hint: string;
  value: string;
  change: KpiChange | null;
  detail: KpiDetail;
  module: { id: string; title: string }; // the page with the charts behind this number
  visual?: React.ReactNode;
};

const TONE_TEXT = { good: "text-green-700", bad: "text-red-700", neutral: "text-gray-500" };
const TONE_PILL = { good: "bg-green-50 text-green-700", bad: "bg-red-50 text-red-700", neutral: "bg-gray-100 text-gray-600" };

function ChangeText({ change, className = "" }: { change: KpiChange | null; className?: string }) {
  if (!change) return <span className={`text-gray-500 ${className}`}>No earlier period to compare</span>;
  const arrow = change.value > 0 ? "▲" : change.value < 0 ? "▼" : "";
  const sign = change.value > 0 ? "+" : "";
  return (
    <span className={`${TONE_TEXT[change.tone]} ${className}`}>
      {arrow} {sign}
      {change.value}
      {change.unit === "pts" ? " pts" : "%"}
    </span>
  );
}

export default function KpiExplorer({
  cards,
  hasPrevious,
  days,
}: {
  cards: KpiCardData[];
  hasPrevious: boolean;
  days: number;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { send, setOpen } = useAssistant();
  const panelId = useId();
  const selected = cards.find((c) => c.key === openKey) ?? null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => {
          const isOpen = card.key === openKey;
          return (
            <button
              key={card.key}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenKey(isOpen ? null : card.key)}
              className={`lift-block group flex h-full flex-col rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 ${
                isOpen ? "border-brand-500 bg-brand-50" : "border-gray-200 bg-white hover:border-gray-400"
              }`}
            >
              <span className="flex items-start justify-between gap-2 text-xs font-medium text-gray-500">
                {card.label}
                <span aria-hidden="true" className={`transition-transform ${isOpen ? "rotate-180" : ""}`}>
                  ⌄
                </span>
              </span>
              <span className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{card.value}</span>
              <ChangeText change={card.change} className="mt-auto pt-1 text-xs" />
            </button>
          );
        })}
      </div>

      {/* The open card's details */}
      <div id={panelId} role="region" aria-label={selected ? `${selected.label} details` : undefined}>
        {selected && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-600">{selected.label}</p>
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular-nums text-gray-900">{selected.value}</span>
                  {selected.change && (
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${TONE_PILL[selected.change.tone]}`}>
                      <ChangeText change={selected.change} className="!text-inherit" /> vs previous period
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm text-gray-500">{selected.hint}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpenKey(null)}
                aria-label="Close details"
                className="rounded px-2 py-1 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-900"
              >
                ×
              </button>
            </div>

            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">How it&apos;s worked out</p>
                  <p className="mt-1 text-sm text-gray-700">{selected.detail.formula}</p>
                </div>
                {selected.detail.rows.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500">
                        <th className="py-1 text-left font-medium" />
                        <th className="py-1 text-right font-medium">This period</th>
                        {hasPrevious && <th className="py-1 text-right font-medium">Previous</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {selected.detail.rows.map((r) => (
                        <tr key={r.label} className={`border-t border-gray-200 ${r.strong ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                          <td className="py-1.5">{r.label}</td>
                          <td className="py-1.5 text-right tabular-nums">{r.cur}</td>
                          {hasPrevious && <td className="py-1.5 text-right tabular-nums text-gray-500">{r.prev ?? "-"}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {selected.visual && <div>{selected.visual}</div>}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(true);
                  send(`Explain my ${selected.label.toLowerCase()}: it's ${selected.value} this period. What's driving it, and what changed vs last period?`);
                }}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                ✦ Ask AI about this
              </button>
              <Link
                href={`/analytics/${selected.module.id}?days=${days}`}
                className="lift rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-500"
              >
                Open {selected.module.title} →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
