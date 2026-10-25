// One tick of the autonomous loop. Every kind of problem goes through the same steps:
//
//   detect       every playbook's detect (plain code); new findings become 'detected' cases,
//                skipping ones with an open case or in cooldown
//   investigate  up to 3 detected cases: claimed, investigated by the agent on the loop surface
//                (read and draft tools only), which ends with submit_proposal; code checks it
//                against the playbook and proposes the Commit actions (linked by case_id)
//   advance      a proposed case whose Commit action the owner approved and ran -> measuring;
//                all turned down or expired -> dismissed
//   measure      a measuring case whose window ended: metric vs baseline, verdict, report, lesson
//
// Every step claims the case with a conditional update, so overlapping ticks are safe. The
// dependencies are passed in, so the rules can be tested without a database or the AI.
import { lessonFor, reportFor, verdictFor } from "./measure";
import type { CaseRow, CaseStatus, Detected, Lesson, Playbook, Verdict } from "./types";

export const MAX_INVESTIGATIONS = 3;
const DAY = 86400_000;

export type NewCase = { playbook: string; finding_key: string; status: "detected"; facts: Record<string, unknown>; evidence: Detected["evidence"]; is_demo?: boolean };

export type CaseStore = {
  insert(c: NewCase): Promise<CaseRow | null>; // null when the finding already has an open case
  inCooldown(findingKey: string, sinceIso: string): Promise<boolean>; // closed, dismissed or failed since then
  openCount(playbook: string): Promise<number>;
  claim(id: number, from: CaseStatus[], patch: Partial<CaseRow>): Promise<CaseRow | null>;
  list(statuses: CaseStatus[], limit: number): Promise<CaseRow[]>;
  lessons(playbook: string, n: number): Promise<Lesson[]>;
  actionsFor(caseId: number): Promise<{ id: number; tool: string; status: string }[]>;
};

export type Investigation = { submission: { recommendation: string; why: string; action_tools: string[]; args: Record<string, Record<string, unknown>> } | null; drafted: string[] };

export type EngineDeps = {
  store: CaseStore;
  playbooks: Playbook[];
  detect(playbook: Playbook): Promise<Detected[]>;
  // The agent on the loop surface, limited to the playbook's tools. Returns what it submitted.
  investigate(c: CaseRow, playbook: Playbook, lessons: Lesson[]): Promise<Investigation>;
  isCommit(tool: string): boolean;
  // Proposes one Commit action for the case (through the Commit tool, as the loop). Facts it
  // returns (the promoted dish, the discount) are kept on the case for measuring.
  proposeCommit(tool: string, args: Record<string, unknown>, c: CaseRow): Promise<{ action_id: number; facts?: Record<string, unknown> } | { error: string }>;
  measureCase(c: CaseRow, playbook: Playbook): ReturnType<Playbook["measure"]>;
  now(): Date;
  log?(line: string): void;
};

export type TickReport = { detected: string[]; skipped: string[]; proposed: number[]; failed: { id: number; error: string }[]; measuring: number[]; dismissed: number[]; closed: number[]; errors: string[] };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------- detect ----------

export async function detectStep(deps: EngineDeps, report: TickReport) {
  for (const pb of deps.playbooks) {
    let found: Detected[] = [];
    try {
      found = await deps.detect(pb);
    } catch (err) {
      report.errors.push(`${pb.id} detect: ${message(err)}`);
      continue;
    }
    let open = await deps.store.openCount(pb.id);
    for (const f of found) {
      const since = new Date(deps.now().getTime() - pb.limits.cooldownDays * DAY).toISOString();
      if (open >= pb.limits.maxOpen || (await deps.store.inCooldown(f.finding_key, since))) {
        report.skipped.push(f.finding_key);
        continue;
      }
      const made = await deps.store.insert({
        playbook: pb.id, finding_key: f.finding_key, status: "detected",
        facts: { ...f.facts, title: f.title, impact_usd_week: f.impact_usd_week, basis: f.basis }, evidence: f.evidence,
      });
      if (!made) {
        report.skipped.push(f.finding_key); // already has an open case
        continue;
      }
      open++;
      report.detected.push(f.finding_key);
    }
  }
}

// ---------- investigate and propose ----------

// Which detected cases to investigate this tick: the most valuable of each playbook first (so one
// kind of problem can't take every slot), then the rest by dollars a week.
export function pickForInvestigation(cases: CaseRow[], max: number): CaseRow[] {
  const worth = (c: CaseRow) => (typeof c.facts.impact_usd_week === "number" ? c.facts.impact_usd_week : -1);
  const ranked = [...cases].sort((a, b) => worth(b) - worth(a) || a.id - b.id);
  const picked: CaseRow[] = [];
  const seen = new Set<string>();
  for (const c of ranked) {
    if (picked.length < max && !seen.has(c.playbook)) {
      picked.push(c);
      seen.add(c.playbook);
    }
  }
  for (const c of ranked) if (picked.length < max && !picked.includes(c)) picked.push(c);
  return picked;
}

export async function investigateStep(deps: EngineDeps, report: TickReport, max = MAX_INVESTIGATIONS) {
  const waiting = pickForInvestigation(await deps.store.list(["detected"], 50), max);
  for (const c of waiting) {
    const pb = deps.playbooks.find((p) => p.id === c.playbook);
    if (!pb) continue;
    const claimed = await deps.store.claim(c.id, ["detected"], { status: "investigating" });
    if (!claimed) continue; // another tick has it
    try {
      const lessons = await deps.store.lessons(pb.id, 5);
      const { submission, drafted } = await deps.investigate(claimed, pb, lessons);
      if (!submission) throw new Error("The agent didn't submit a proposal.");
      const outside = submission.action_tools.filter((t) => !pb.actions.includes(t));
      if (outside.length) throw new Error(`The proposal used tools this playbook doesn't allow: ${outside.join(", ")}.`);

      const actionIds: number[] = [];
      const errors: string[] = [];
      let facts = { ...claimed.facts };
      if (pb.autonomy === "propose") {
        for (const tool of submission.action_tools.filter((t) => deps.isCommit(t))) {
          const made = await deps.proposeCommit(tool, submission.args[tool] ?? {}, claimed);
          if ("error" in made) errors.push(`${tool}: ${made.error}`);
          else {
            actionIds.push(made.action_id);
            facts = { ...facts, ...made.facts };
          }
        }
      }
      // A Commit action was the point of the proposal and none could be made: the case failed
      if (errors.length && !actionIds.length) throw new Error(errors.join(" "));
      const proposed = await deps.store.claim(claimed.id, ["investigating"], {
        status: "proposed",
        facts,
        proposal: { recommendation: submission.recommendation, why: submission.why, action_tools: submission.action_tools, action_ids: actionIds, drafted },
        goal: pb.goal(facts),
        baseline: { method: pb.baseline, value: null },
        error: errors.length ? errors.join(" ") : null,
      });
      if (proposed) report.proposed.push(proposed.id);
    } catch (err) {
      await deps.store.claim(claimed.id, ["investigating"], { status: "failed", error: message(err) });
      report.failed.push({ id: claimed.id, error: message(err) });
    }
  }
}

// ---------- after approval ----------

export async function advanceStep(deps: EngineDeps, report: TickReport) {
  for (const c of await deps.store.list(["proposed"], 50)) {
    const pb = deps.playbooks.find((p) => p.id === c.playbook);
    if (!pb) continue;
    // Only this proposal's own actions count (not older ones on the same case)
    const mine = new Set(c.proposal?.action_ids ?? []);
    const actions = (await deps.store.actionsFor(c.id)).filter((a) => mine.has(a.id));
    const done = actions.some((a) => a.status === "done");
    const allOff = actions.length > 0 && actions.every((a) => ["rejected", "expired", "failed", "undone"].includes(a.status));
    // Nothing for the owner to approve: it stays proposed (a recommendation to read)
    if (done) {
      const start = deps.now();
      const moved = await deps.store.claim(c.id, ["proposed"], { status: "measuring", window_start: start.toISOString(), window_end: new Date(start.getTime() + pb.window.days * DAY).toISOString() });
      if (moved) report.measuring.push(c.id);
    } else if (allOff) {
      const moved = await deps.store.claim(c.id, ["proposed"], { status: "dismissed", closed_at: deps.now().toISOString() });
      if (moved) report.dismissed.push(c.id);
    }
  }
}

// ---------- measure ----------

// With no baseline to compare (stockouts), the target decides: met is above usual, missed below.
export function targetVerdict(value: number | null, target: number, direction: "up" | "down", days: number): Verdict {
  if (value === null || days < 7) return "too early to tell";
  if (value === target) return "above usual";
  return (direction === "down" ? value < target : value > target) ? "above usual" : "below usual";
}

export async function measureStep(deps: EngineDeps, report: TickReport) {
  const now = deps.now();
  for (const c of await deps.store.list(["measuring"], 50)) {
    if (!c.window_end || Date.parse(c.window_end) > now.getTime()) continue;
    const pb = deps.playbooks.find((p) => p.id === c.playbook);
    if (!pb) continue;
    try {
      const m = await deps.measureCase(c, pb);
      const goal = c.goal ?? pb.goal(c.facts);
      const verdict =
        pb.baseline === "none"
          ? targetVerdict(m.value, goal.target ?? 0, goal.direction, m.sample.days)
          : verdictFor({ value: m.value, baseline: m.baseline, direction: goal.direction, days: m.sample.days, orders: m.sample.orders, needsOrders: pb.id === "sales_dip" });
      const difference = m.value !== null && m.baseline !== null ? Math.round((m.value - m.baseline) * 100) / 100 : null;
      const baselineMethod = { same_weekdays_prior_4w: "the same weekdays in the 4 weeks before", previous_invoices: "the invoices before", forecast: "the forecast", none: "the goal" }[pb.baseline];
      const reportText = reportFor({ title: String(c.facts.title ?? pb.title), action: m.action || "nothing approved", goal, value: m.value, baseline: m.baseline, baselineMethod, sample: m.sample, cost: m.cost, verdict });
      const closed = await deps.store.claim(c.id, ["measuring"], {
        status: "closed",
        result: { value: m.value, baseline: m.baseline, difference, sample: m.sample, cost: m.cost, verdict },
        baseline: { method: pb.baseline, value: m.baseline },
        report: reportText,
        lesson: lessonFor(pb.id, m.action, m.item, verdict, m.value, m.baseline),
        closed_at: now.toISOString(),
      });
      if (closed) report.closed.push(c.id);
    } catch (err) {
      report.errors.push(`case ${c.id} measure: ${message(err)}`);
    }
  }
}

export async function tick(deps: EngineDeps): Promise<TickReport> {
  const report: TickReport = { detected: [], skipped: [], proposed: [], failed: [], measuring: [], dismissed: [], closed: [], errors: [] };
  for (const step of [detectStep, investigateStep, advanceStep, measureStep]) {
    try {
      await step(deps, report);
    } catch (err) {
      report.errors.push(message(err));
    }
  }
  return report;
}
