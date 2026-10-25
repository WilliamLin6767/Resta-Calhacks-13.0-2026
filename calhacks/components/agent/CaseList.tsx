import Badge, { type BadgeTone } from "@/components/Badge";
import EmptyState from "@/components/ui/EmptyState";
import type { CaseRow, CaseStatus } from "@/lib/loop/types";
import ActionCard from "./ActionCard";

const STATUS: Record<CaseStatus, { label: string; tone: BadgeTone }> = {
  detected: { label: "Found", tone: "gray" },
  investigating: { label: "Investigating", tone: "gray" },
  proposed: { label: "Waiting for you", tone: "amber" },
  approved: { label: "Approved", tone: "gray" },
  running: { label: "Running", tone: "gray" },
  measuring: { label: "Measuring", tone: "gray" },
  closed: { label: "Closed", tone: "green" },
  dismissed: { label: "Dismissed", tone: "gray" },
  failed: { label: "Failed", tone: "red" },
};

const PLAYBOOK: Record<string, string> = { supplier_price_rise: "Supplier price rise", sales_dip: "Sales dip", stockout_risk: "Stockout risk" };
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

// The loop's cases: what Resta found, what it proposed, and (once measured) how it went.
export default function CaseList({ cases, showActions = true }: { cases: CaseRow[]; showActions?: boolean }) {
  if (!cases.length) return <EmptyState title="No cases yet. Press Run now and Resta looks for problems on its own." icon="check" />;
  return (
    <ul className="space-y-3">
      {cases.map((c) => {
        const s = STATUS[c.status];
        return (
          <li key={c.id} className="rounded-xl border border-brand-100 bg-white p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-gray-900">{String(c.facts.title ?? PLAYBOOK[c.playbook] ?? c.playbook)}</p>
              <Badge tone={s.tone}>{s.label}</Badge>
              {c.is_demo && <Badge tone="gray">Demo data</Badge>}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {PLAYBOOK[c.playbook] ?? c.playbook} · case #{c.id} · {when(c.created_at)}
              {c.window_end && c.status === "measuring" ? ` · measuring until ${when(c.window_end)}` : ""}
            </p>
            {c.proposal && (
              <p className="mt-2 text-gray-700">
                <span className="font-medium">Proposed:</span> {c.proposal.recommendation}
              </p>
            )}
            {c.report && <p className="mt-2 text-gray-700">{c.report}</p>}
            {c.error && c.status === "failed" && <p className="mt-2 text-red-600">{c.error}</p>}
            {showActions && c.status === "proposed" && (c.proposal?.action_ids.length ?? 0) > 0 && (
              <div className="mt-3 space-y-2">
                {c.proposal!.action_ids.map((id) => (
                  <ActionCard key={id} action={{ id, title: "Loading...", summary: "" }} />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
