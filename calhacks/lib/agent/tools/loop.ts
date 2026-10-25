// The loop's last step: the agent submits one recommendation for the case it investigated. Code
// checks every tool against the playbook (lib/loop/engine.ts proposes the Commit ones); anything
// else is refused. Only on the loop surface.
import { z } from "zod";
import { defineTool, json } from "../types";

export const loopTools = [
  defineTool({
    name: "submit_proposal",
    tier: "draft",
    area: "findings",
    surfaces: ["loop"],
    description:
      "End your investigation with exactly one recommendation for the owner: what to do, why (with the numbers your tools returned), the tools for the actions " +
      "(only ones this playbook allows), and their arguments by tool name, e.g. { \"place_call\": { \"call\": \"12\" } }. Nothing runs until the owner approves.",
    input: z.object({
      recommendation: z.string().min(5).max(500),
      why: z.string().min(5).max(1500),
      action_tools: z.array(z.string()).max(4),
      args: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
    }),
    run: async (input, ctx) => {
      if (!ctx.loop) return "Error: submit_proposal is only for the loop.";
      const outside = input.action_tools.filter((t) => !ctx.loop!.allowed.includes(t));
      if (outside.length) return `Error: ${outside.join(", ")} ${outside.length === 1 ? "isn't" : "aren't"} allowed for this case. Allowed: ${ctx.loop.allowed.join(", ")}.`;
      if (ctx.loop.submission) return "Error: a proposal was already submitted for this case.";
      // Wrong arguments are caught now, while the agent can still fix them
      const problems = input.action_tools.map((t) => ctx.loop!.checkArgs?.(t, input.args[t] ?? {})).filter((p): p is string => Boolean(p));
      if (problems.length) return `Error: fix the arguments and submit again. ${problems.join(" ")}`;
      ctx.loop.submission = { recommendation: input.recommendation, why: input.why, action_tools: input.action_tools, args: input.args };
      return json({ ok: true, note: "Submitted. The owner will see it and approve or reject the actions." });
    },
  }),
];
