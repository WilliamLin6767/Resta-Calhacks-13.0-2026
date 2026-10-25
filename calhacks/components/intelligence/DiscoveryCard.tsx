import Link from "next/link";
import { AREA_INFO, type Discovery } from "@/lib/intelligence/types";
import { AREA_STYLE, askHref } from "./areaStyle";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// One cross-department discovery: what Resta noticed, which departments it joins, why it matters,
// the dollars (with how they were worked out), the evidence, and the next step. "Investigate with
// Resta" opens the same agent with the discovery's key, so it can pull the full evidence.
export default function DiscoveryCard({ d }: { d: Discovery }) {
  const verified = d.status === "verified";
  return (
    <article id={d.key} className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
            verified ? "bg-green-50 text-green-800 ring-green-600/20" : "bg-amber-50 text-amber-800 ring-amber-600/25"
          }`}
        >
          {verified ? "Verified" : "Hypothesis"}
        </span>
        {d.areas.map((a) => (
          <span key={a} className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${AREA_STYLE[a].chip}`}>{AREA_INFO[a].label}</span>
        ))}
        {d.severity === "high" && <span className="text-xs font-medium text-red-700">High priority</span>}
      </div>

      <h3 className="mt-3 text-lg leading-snug font-semibold text-gray-900">{d.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-700">{d.noticed}</p>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">
        <span className="font-medium text-gray-700">Why it matters: </span>
        {d.why}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="rounded-xl bg-gray-50 p-4">
          {d.impact ? (
            <>
              <p className="text-xs text-gray-500">{d.impact.per === "week" ? "A week" : "One time"}{d.kind === "promo_with_stock" ? ", already lost" : ""}</p>
              <p className="text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{money(d.impact.amount_usd)}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{d.impact.basis}</p>
              {d.impact.assumptions.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
                  {d.impact.assumptions.map((a) => <li key={a}>Assumes: {a.replace(/^Assumes /, "")}</li>)}
                </ul>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">Dollar figure</p>
              <p className="mt-1 text-sm text-gray-700">Not enough data for a defensible number. The evidence is shown instead.</p>
            </>
          )}
        </div>
        <dl className="divide-y divide-gray-100 text-sm">
          {d.evidence.map((e, i) => (
            <div key={`${e.label}-${i}`} className="flex items-baseline gap-3 py-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${AREA_STYLE[e.area].dot}`} aria-hidden="true" />
              <dt className="w-32 shrink-0 text-gray-500">{e.label}</dt>
              <dd className="min-w-0 flex-1 text-gray-900">
                {e.href ? <Link href={e.href} className="hover:underline">{e.value}</Link> : e.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
        <span className="mr-1 text-sm font-medium text-gray-900">{d.next.label}</span>
        <Link href={askHref(`${d.next.ask} [${d.key}]`)} className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Investigate with Resta
        </Link>
        <Link href={d.next.href} className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400">
          {d.next.hrefLabel}
        </Link>
        {d.case && (
          <Link href="/actions?tab=cases" className="text-sm text-gray-500 hover:underline">
            Loop case #{d.case.id}: {d.case.status}
          </Link>
        )}
      </div>
    </article>
  );
}
