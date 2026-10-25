// The loop with its real parts (server only): the playbooks, the cases on Supabase, the agent on
// the loop surface, and the Commit tools proposing as the loop. Called by /api/loop/tick (cron)
// and by the owner's Run now (/api/loop/run).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENT_TOOLS, createCtx } from "@/lib/agent/registry";
import { runAgent } from "@/lib/agent/run";
import { clearPicture } from "@/lib/intelligence/load";
import { signalAfter } from "@/lib/live/signal";
import { tick, type EngineDeps, type TickReport } from "./engine";
import { PLAYBOOKS } from "./playbooks";
import { CasesTableMissing, supabaseCases } from "./store";
import type { CaseRow, Lesson, Playbook } from "./types";

const COMMIT = new Set(AGENT_TOOLS.filter((t) => t.tier === "commit").map((t) => t.name));
const commitTool = (name: string) => AGENT_TOOLS.find((t) => t.name === name && t.tier === "commit");

// "post (string), offer (string), discount_usd (number, optional)": a Commit tool's arguments
function argList(name: string): string {
  const shape = (commitTool(name)?.input as { shape?: Record<string, { isOptional?: () => boolean; def?: { type?: string } }> } | undefined)?.shape ?? {};
  return Object.entries(shape)
    .map(([key, s]) => `${key}${s.isOptional?.() ? " (optional)" : ""}`)
    .join(", ");
}

// Why a Commit tool's arguments won't work, or null (submit_proposal checks before accepting)
function checkArgs(name: string, args: Record<string, unknown>): string | null {
  const tool = commitTool(name);
  if (!tool) return null; // a draft tool: it already ran during the investigation
  const parsed = tool.input.safeParse(args);
  if (parsed.success) return null;
  return `${name} needs { ${argList(name)} } but got ${JSON.stringify(args)} (${parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}).`;
}

function prompt(c: CaseRow, pb: Playbook, lessons: Lesson[]) {
  const commits = pb.actions.filter((a) => COMMIT.has(a));
  return [
    `Resta found this on its own: ${String(c.facts.title ?? pb.title)}.`,
    `Facts worked out in code:\n${JSON.stringify(c.facts, null, 1)}`,
    `Evidence:\n${c.evidence.map((e) => `- ${e.label}: ${e.value}`).join("\n")}`,
    `Your task: ${pb.investigate.question}`,
    `Actions you may propose: ${pb.actions.join(", ")}. Commit actions are only proposed through submit_proposal: put the tool in action_tools and its arguments under args, by tool name. ` +
      `The owner approves each one. Their arguments:\n${commits.map((t) => `- ${t}: { ${argList(t)} }`).join("\n") || "- none"}` +
      (commits.includes("place_call") ? `\nTo put an existing pending call request in front of the owner, use place_call with { "call": "<its number>" }.` : ""),
    lessons.length ? `What happened the last times (association, not proof):\n${lessons.map((l) => `- ${l.action} on ${l.item}: ${l.verdict}${l.difference !== null ? ` (${l.difference > 0 ? "+" : ""}${l.difference})` : ""}`).join("\n")}` : "",
    "Investigate with your tools, then end by calling submit_proposal exactly once. Use only numbers your tools returned.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function loopDeps(db: SupabaseClient): EngineDeps {
  return {
    store: supabaseCases(db),
    playbooks: PLAYBOOKS,
    detect: (pb) => pb.detect(db),
    async investigate(c, pb, lessons) {
      const allowed = pb.actions;
      const loop = { caseId: c.id, playbook: pb.id, allowed, submission: null, checkArgs };
      const result = await runAgent({
        surface: "loop",
        messages: [{ role: "user", content: prompt(c, pb, lessons) }],
        identity: "loop",
        loop,
        toolNames: [...pb.investigate.tools, ...allowed.filter((a) => !COMMIT.has(a)), "submit_proposal"],
      });
      return { submission: result.submission, drafted: result.changes.map((ch) => ch.label) };
    },
    isCommit: (tool) => COMMIT.has(tool),
    async proposeCommit(toolName, args, c) {
      const tool = AGENT_TOOLS.find((t) => t.name === toolName && t.tier === "commit");
      if (!tool) return { error: "not a Commit tool" };
      const parsed = tool.input.safeParse(args);
      if (!parsed.success) return { error: `bad arguments (${parsed.error.issues.map((i) => i.message).join("; ")})` };
      const weekly = typeof c.facts.impact_usd_week === "number" ? c.facts.impact_usd_week : null;
      const ctx = createCtx({
        db,
        surface: "loop",
        identity: "loop",
        loop: {
          caseId: c.id,
          playbook: c.playbook,
          allowed: [],
          submission: null,
          // What the problem costs a week (labeled as such, not a promise of what the action recovers)
          impact: weekly !== null ? { amount_usd: weekly, per: "week", basis: `What the problem costs now, not a forecast of what this recovers: ${String(c.facts.basis ?? "")}` } : null,
          evidence: c.evidence,
        },
      });
      const out = await tool.run(parsed.data, ctx).catch((err: unknown) => `Error: ${err instanceof Error ? err.message : String(err)}`);
      if (out.startsWith("Error")) return { error: out.replace(/^Error:\s*/, "") };
      const body = JSON.parse(out) as { ok?: boolean; ask?: string; proposed?: { action_id: number }; facts?: Record<string, unknown> };
      if (!body.proposed) return { error: body.ask ?? "nothing was proposed" };
      return { action_id: body.proposed.action_id, facts: body.facts };
    },
    measureCase: (c, pb) => pb.measure(db, c),
    now: () => new Date(),
  };
}

export async function runTick(db: SupabaseClient): Promise<TickReport> {
  // Without the cases table nothing can run: say so instead of a report full of the same error
  const probe = await db.from("cases").select("id").limit(1);
  if (probe.error) throw new CasesTableMissing(`The loop isn't set up: run supabase/19_cases.sql. (${probe.error.message})`);
  const report = await tick(loopDeps(db));
  clearPicture(); // the Intelligence page and the agent see the new cases on their next read
  if (report.detected.length || report.proposed.length || report.measuring.length || report.closed.length || report.dismissed.length) signalAfter("/api/loop/tick");
  return report;
}
