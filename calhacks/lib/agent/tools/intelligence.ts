// The operating picture (lib/intelligence): layer 2, a department's detail or one cross-department
// discovery's full evidence, and layer 3, what was tried before and how it went. The prompt carries
// layer 1 (lib/intelligence/context.ts); these are the same picture the Intelligence page shows.
import { z } from "zod";
import { loadPicture } from "@/lib/intelligence/load";
import { AREAS } from "@/lib/intelligence/types";
import { listCases } from "@/lib/loop/store";
import { RESTAURANT_ID } from "@/lib/supabase";
import { capped, json, defineTool } from "../types";

export const intelligenceTools = [
  defineTool({
    name: "get_operating_picture",
    tier: "read",
    area: "findings",
    description:
      "The whole restaurant at once, worked out in code: each department's headline numbers and how fresh they are, the cross-department discoveries " +
      "(each VERIFIED or HYPOTHESIS, with evidence, the basis of any dollar figure, and the tools that act on it), the top single-department findings, " +
      `actions waiting for approval and what the loop did. Leave everything out for the overview; area (${AREAS.join(", ")}) for one department; ` +
      "discovery (its key, like cost-squeeze:beef brisket) for one discovery in full. refresh rebuilds it instead of using the last few minutes' copy.",
    input: z.object({ area: z.enum(AREAS).optional(), discovery: z.string().max(120).optional(), refresh: z.boolean().optional() }),
    run: async ({ area, discovery, refresh }, ctx) => {
      const p = await loadPicture(ctx.db, { fresh: refresh });
      if (discovery) {
        const d = p.discoveries.find((x) => x.key === discovery.trim());
        if (!d) return `Error: no discovery "${discovery}". Current ones: ${p.discoveries.map((x) => x.key).join(", ") || "none"}.`;
        return json({ generated_at: p.generated_at, discovery: d });
      }
      if (area) {
        const a = p.areas.find((x) => x.id === area)!;
        return json({ generated_at: p.generated_at, area: a, discoveries: p.discoveries.filter((d) => d.areas.includes(area)).map((d) => ({ key: d.key, status: d.status, title: d.title })) });
      }
      return json({
        generated_at: p.generated_at,
        areas: p.areas.map((a) => ({ id: a.id, available: a.available, error: a.error, stale: a.stale, as_of: a.as_of, facts: a.facts })),
        discoveries: p.discoveries.map((d) => ({ key: d.key, status: d.status, severity: d.severity, areas: d.areas, title: d.title, impact: d.impact, next: d.next.tools, case: d.case })),
        findings: p.findings,
        waiting_for_approval: p.pending,
        pipeline: p.stages,
      });
    },
  }),
  defineTool({
    name: "get_case_history",
    tier: "read",
    area: "findings",
    description:
      "What Resta tried before and how it went: closed loop cases with their measured result, verdict and lesson (association, not proof), and actions " +
      "the owner approved or turned down. Use before recommending something similar again. playbook: supplier_price_rise, sales_dip or stockout_risk.",
    input: z.object({ playbook: z.string().max(60).optional() }),
    run: async ({ playbook }, ctx) => {
      const [cases, actions] = await Promise.all([
        listCases(ctx.db, { statuses: ["closed", "dismissed", "failed"], limit: 20 }).catch((e: unknown) => e instanceof Error ? e.message : String(e)),
        ctx.db.from("agent_actions").select("id, tool, title, status, source, done_at, error, case_id").eq("restaurant_id", RESTAURANT_ID)
          .in("status", ["done", "rejected", "failed", "undone"]).order("created_at", { ascending: false }).limit(20),
      ]);
      const past = typeof cases === "string" ? cases : cases
        .filter((c) => !playbook || c.playbook === playbook)
        .map((c) => ({ id: c.id, playbook: c.playbook, title: c.facts.title ?? null, status: c.status, recommendation: c.proposal?.recommendation ?? null, result: c.result, report: c.report, lesson: c.lesson, closed_at: c.closed_at }));
      return json({
        cases: typeof past === "string" ? { error: past } : capped(past, 12),
        actions: actions.error ? { error: actions.error.message } : capped(actions.data ?? [], 12),
      });
    },
  }),
];
