import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Card from "@/components/Card";
import ErrorMessage from "@/components/ErrorMessage";
import AskResta from "@/components/intelligence/AskResta";
import ContextHub from "@/components/intelligence/ContextHub";
import DiscoveryCard from "@/components/intelligence/DiscoveryCard";
import { when } from "@/components/intelligence/areaStyle";
import LiveRefresh from "@/components/live/LiveRefresh";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonLines } from "@/components/ui/Skeleton";
import { loadPicture } from "@/lib/intelligence/load";
import { STAGES, type Picture } from "@/lib/intelligence/types";
import { getSupabase } from "@/lib/supabase";

export const metadata: Metadata = { title: "Intelligence" };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function Tile({ label, value, sub, href }: { label: string; value: string; sub: React.ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-gray-900 tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-gray-500">{sub}</p>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-2xl border border-brand-100 bg-white p-5 hover:border-brand-200">{body}</Link>
  ) : (
    <div className="rounded-2xl border border-brand-100 bg-white p-5">{body}</div>
  );
}

// A. The operating picture in four measurable numbers, plus the top single-department findings.
// Context only: approvals are decided on the Actions page.
function OperatingPicture({ p }: { p: Picture }) {
  const verified = p.discoveries.filter((d) => d.status === "verified");
  const weekly = verified.filter((d) => d.impact?.per === "week");
  const atStake = weekly.reduce((s, d) => s + (d.impact?.amount_usd ?? 0), 0);
  const live = p.areas.filter((a) => a.available);
  const down = p.areas.filter((a) => !a.available || a.stale);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Cross-department discoveries" value={String(p.discoveries.length)} sub={`${verified.length} verified, ${p.discoveries.length - verified.length} hypotheses`} />
        <Tile
          label="Verified money at stake a week"
          value={weekly.length ? money(atStake) : "None"}
          sub={weekly.length ? `From ${weekly.length} verified finding${weekly.length === 1 ? "" : "s"} with a figure. Basis on each card.` : "No verified weekly figure right now."}
        />
        <Tile label="Findings in one department" value={String(p.findings.length)} sub={p.findings[0]?.title ?? "Nothing stands out"} href="/" />
        <Tile
          label="Departments feeding Resta"
          value={`${live.length} of ${p.areas.length}`}
          sub={down.length ? `${down.map((a) => `${a.label}${a.available ? " (stale)" : " (unavailable)"}`).join(", ")}` : "All loaded and current"}
        />
      </div>
      {p.findings.length > 0 && (
        <Card title="Top findings in one department" action={<Link href="/" className="text-xs font-medium text-brand-700 hover:underline">Overview</Link>}>
          <ul className="divide-y divide-gray-100">
            {p.findings.slice(0, 4).map((f) => (
              <li key={f.key} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                <span className="text-gray-800">{f.title}</span>
                <span className="shrink-0 text-gray-500 tabular-nums">{f.impact_usd_week !== null ? `${money(f.impact_usd_week)}/wk` : f.level === "act" ? "Needs a decision" : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// D. What Resta actually did: the loop's cases and the action log, by stage. Read only: anything
// waiting for the owner is counted here and decided in Actions.
function Activity({ p }: { p: Picture }) {
  const shown = p.activity.filter((a) => a.stage !== "Awaiting approval");
  return (
    <Card title="What Resta is working on" action={<Link href="/actions?tab=cases" className="text-xs font-medium text-brand-700 hover:underline">All cases</Link>}>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {STAGES.map((s, i) => {
          const body = (
            <>
              <p className="text-[11px] font-medium tracking-wide text-gray-500 uppercase">{i + 1}. {s}</p>
              <p className={`text-xl font-semibold tabular-nums ${p.stages[s] ? "text-brand-700" : "text-gray-400"}`}>{p.stages[s]}</p>
            </>
          );
          return (
            <li key={s} className={`rounded-xl px-3 py-2 ${p.stages[s] ? "bg-brand-50" : "bg-gray-50"}`}>
              {s === "Awaiting approval" && p.stages[s] ? <Link href="/actions" className="block" title="Decide them in Actions">{body}</Link> : body}
            </li>
          );
        })}
      </ol>
      {shown.length ? (
        <ul className="mt-4 divide-y divide-gray-100">
          {shown.map((a) => (
            <li key={a.key}>
              <Link href={a.href} className="flex items-start gap-3 py-2.5 hover:bg-gray-50">
                <span className="mt-0.5 w-32 shrink-0 text-xs font-medium text-brand-700">{a.stage}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-900">{a.title}</span>
                  {a.detail && <span className="line-clamp-1 block text-xs text-gray-500">{a.detail}</span>}
                </span>
                <span className="shrink-0 text-xs text-gray-400">{when(a.at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing yet. Press Run now on Actions and Resta looks for problems on its own." icon="check" />
      )}
    </Card>
  );
}

async function Mission({ searchParams }: { searchParams: PageProps<"/intelligence">["searchParams"] }) {
  const fresh = (await searchParams).refresh === "1";
  let p: Picture;
  try {
    p = await loadPicture(await getSupabase(), { fresh });
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : "Could not build the operating picture."} />;
  }
  return (
    <div className="space-y-8">
      <p className="-mt-4 text-xs text-gray-500">
        Worked out from your data at {when(p.generated_at)}. The assistant reads this same picture.{" "}
        <Link href="/intelligence?refresh=1" className="font-medium text-brand-700 hover:underline">Refresh</Link>
      </p>

      <section aria-labelledby="picture">
        <h2 id="picture" className="sr-only">Operating picture</h2>
        <OperatingPicture p={p} />
      </section>

      <section aria-labelledby="discoveries" className="space-y-4">
        <div>
          <h2 id="discoveries" className="text-xl font-semibold text-gray-900">Cross-department discoveries</h2>
          <p className="mt-1 text-sm text-gray-500">
            Found by fixed rules that join departments. Verified: every part is a recorded number. Hypothesis: the numbers are real, the link is a guess to check.
          </p>
        </div>
        {p.discoveries.length ? (
          p.discoveries.map((d) => <DiscoveryCard key={d.key} d={d} />)
        ) : (
          <Card>
            <EmptyState title="Nothing connects across departments right now." hint="Resta only shows a discovery when the data supports every part of it." icon="check" />
          </Card>
        )}
      </section>

      <Card title="What Resta knows, and from where">
        <ContextHub areas={p.areas} discoveries={p.discoveries} />
      </Card>

      <Activity p={p} />

      <Card title="Ask Resta">
        <p className="mb-3 text-sm text-gray-500">The assistant starts with everything on this page, and looks deeper with its tools.</p>
        <AskResta suggestions={p.discoveries.map((d) => d.next.ask)} />
      </Card>
    </div>
  );
}

// Mission control: what the one assistant currently knows about the whole restaurant, what it found
// across departments, and what it's doing about it. Built from the same operating picture the
// assistant's prompt and tools read (lib/intelligence).
export default function IntelligencePage({ searchParams }: PageProps<"/intelligence">) {
  return (
    <div>
      <LiveRefresh topics={["actions"]} />
      <PageHeader title="Intelligence" description="What Resta sees across the whole restaurant, what it connected, and what it's doing about it." />
      <Suspense fallback={<SkeletonLines />}>
        <Mission searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
