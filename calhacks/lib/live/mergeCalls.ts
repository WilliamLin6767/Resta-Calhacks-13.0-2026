// Folds what Convex pushes about supplier calls into the rows a calls panel already shows
// (pure; components/calls/CallRequests.tsx). Only what changed since the panel last saw it is
// applied, so a Convex copy that's behind Supabase never overwrites newer rows.
import type { CallRow } from "@/lib/calls/types";

export type LiveCallUpdate = {
  callId: number;
  status: CallRow["status"];
  progress?: string | null;
  question?: string | null;
  outcome?: string | null;
  stage?: "summarizing" | null;
  updatedAt: number;
};

type Mergeable = Pick<CallRow, "id" | "status" | "progress" | "question" | "outcome" | "result">;

const UNDER_WAY: CallRow["status"][] = ["approved", "calling", "needs_input"];

// `seen` (callId -> updatedAt) is kept by the panel between calls; the first batch only fills it.
// reload: a new call appeared, or one left "under way" (done, failed, rejected...), so the panel
// should load the full rows again (suggested actions, outcome, the switch check).
export function mergeLiveCalls<T extends Mergeable>(rows: T[], live: LiveCallUpdate[], seen: Map<number, number>): { rows: T[]; reload: boolean } {
  const first = seen.size === 0;
  const changed = new Map<number, LiveCallUpdate>();
  let reload = false;
  for (const call of live) {
    const before = seen.get(call.callId);
    seen.set(call.callId, call.updatedAt);
    if (first || before === call.updatedAt) continue;
    if (before === undefined && !rows.some((r) => r.id === call.callId)) reload = true; // a new call
    else changed.set(call.callId, call);
  }
  if (changed.size === 0) return { rows, reload };
  const next = rows.map((row) => {
    const call = changed.get(row.id);
    if (!call) return row;
    if (call.status !== row.status && !UNDER_WAY.includes(call.status)) reload = true;
    return {
      ...row,
      status: call.status,
      progress: call.progress ?? null,
      question: call.question ?? null,
      outcome: call.outcome ?? row.outcome,
      result: call.stage ? { ...(row.result ?? {}), stage: call.stage } : row.result,
    };
  });
  return { rows: next, reload };
}
