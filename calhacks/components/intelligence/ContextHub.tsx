"use client";

import Link from "next/link";
import { useState } from "react";
import type { AreaId, AreaSnapshot, Discovery } from "@/lib/intelligence/types";
import { AREA_STYLE, when } from "./areaStyle";

// Where the agent's operating picture comes from: Resta in the middle, each department around it.
// A spoke is solid when that department's data loaded and dashed when it didn't. A line between
// two departments appears only when a discovery really joins them. Clicking a department shows what
// the agent can see about it right now (the same snapshot its prompt and tools read).
const W = 640;
const H = 380;
const CX = W / 2;
const CY = H / 2;

function position(i: number, n: number) {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return { x: CX + Math.cos(a) * 250, y: CY + Math.sin(a) * 140 };
}

export default function ContextHub({ areas, discoveries }: { areas: AreaSnapshot[]; discoveries: Discovery[] }) {
  const [selected, setSelected] = useState<AreaId>(() => discoveries[0]?.areas[0] ?? areas[0].id);
  const pos = new Map(areas.map((a, i) => [a.id, position(i, areas.length)]));
  const area = areas.find((a) => a.id === selected)!;
  const related = discoveries.filter((d) => d.areas.includes(selected));

  // One line per pair of departments a discovery joins (deduplicated), with how many join them
  const pairs = new Map<string, { a: AreaId; b: AreaId; count: number; keys: string[] }>();
  for (const d of discoveries) {
    for (let i = 0; i < d.areas.length; i++) {
      for (let j = i + 1; j < d.areas.length; j++) {
        const [a, b] = [d.areas[i], d.areas[j]].sort() as [AreaId, AreaId];
        const k = `${a}|${b}`;
        const p = pairs.get(k) ?? { a, b, count: 0, keys: [] };
        p.count += 1;
        p.keys.push(d.key);
        pairs.set(k, p);
      }
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
          {areas.map((a) => {
            const p = pos.get(a.id)!;
            return (
              <line
                key={a.id}
                x1={CX} y1={CY} x2={p.x} y2={p.y}
                stroke={a.available ? (a.id === selected ? AREA_STYLE[a.id].stroke : "var(--color-gray-300)") : "var(--color-gray-300)"}
                strokeWidth={a.id === selected ? 2.5 : 1.5}
                strokeDasharray={a.available ? undefined : "4 5"}
              />
            );
          })}
          {[...pairs.values()].map((p) => {
            const s = pos.get(p.a)!;
            const e = pos.get(p.b)!;
            const on = p.a === selected || p.b === selected;
            // Bend each line toward the middle, so it reads as going through what Resta connects
            const mx = (s.x + e.x) / 2 + (CX - (s.x + e.x) / 2) * 0.45;
            const my = (s.y + e.y) / 2 + (CY - (s.y + e.y) / 2) * 0.45;
            return (
              <path
                key={`${p.a}|${p.b}`}
                d={`M ${s.x} ${s.y} Q ${mx} ${my} ${e.x} ${e.y}`}
                fill="none"
                stroke={on ? "var(--color-brand-500)" : "var(--color-brand-200)"}
                strokeWidth={on ? 2 + Math.min(p.count, 3) : 1.5}
                opacity={on ? 0.9 : 0.6}
              />
            );
          })}
        </svg>

        {/* Resta in the middle */}
        <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: "50%", top: "50%" }}>
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white shadow-lg ring-8 ring-brand-100 md:h-20 md:w-20">
            Resta
          </span>
        </div>

        {areas.map((a) => {
          const p = pos.get(a.id)!;
          const on = a.id === selected;
          const links = discoveries.filter((d) => d.areas.includes(a.id)).length;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelected(a.id)}
              aria-pressed={on}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border bg-white px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shadow-sm md:px-3 md:text-sm ${
                on ? "border-brand-500 text-gray-900 ring-4 ring-brand-100" : "border-gray-200 text-gray-700 hover:border-gray-400"
              } ${a.available ? "" : "opacity-60"}`}
              style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
            >
              <span className={`h-2 w-2 rounded-full ${a.available ? AREA_STYLE[a.id].dot : "bg-gray-300"}`} aria-hidden="true" />
              {a.label}
              {links > 0 && <span className="rounded-full bg-brand-50 px-1.5 text-[11px] text-brand-700">{links}<span className="sr-only"> discoveries</span></span>}
            </button>
          );
        })}
      </div>

      {/* What the agent can see about the selected department */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-900">{area.label}</h3>
          <Link href={area.href} className="text-xs font-medium text-brand-700 hover:underline">Open</Link>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{area.source}</p>
        {!area.available ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Not available right now: {area.error}. Resta says so instead of guessing.</p>
        ) : (
          <>
            <p className={`mt-2 text-xs ${area.stale ? "text-amber-700" : "text-gray-500"}`}>
              {area.stale ? "Stale: " : "Fresh: "}
              {area.as_of ? `data as of ${area.as_of.length > 10 ? when(area.as_of) : area.as_of}` : "loaded just now"}
            </p>
            <dl className="mt-3 space-y-1.5 text-sm">
              {area.facts.map((f) => (
                <div key={f.label} className="flex justify-between gap-3">
                  <dt className="text-gray-500">{f.label}</dt>
                  <dd className="text-right font-medium text-gray-900 tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <p className="mt-4 text-xs font-medium text-gray-500">Resta looks deeper with</p>
        <p className="mt-1 flex flex-wrap gap-1">
          {area.tools.map((t) => (
            <code key={t} className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-gray-600 ring-1 ring-gray-200">{t}</code>
          ))}
        </p>
        {related.length > 0 && (
          <>
            <p className="mt-4 text-xs font-medium text-gray-500">Connected in</p>
            <ul className="mt-1 space-y-1 text-sm">
              {related.map((d) => (
                <li key={d.key}>
                  <a href={`#${d.key}`} className="text-gray-800 hover:underline">{d.title}</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
