// Supplier calls: read them, propose one (the owner's request; it waits for approval and never
// dials), and scan for calls worth making (the same services as /api/calls/request and /scan).
import { z } from "zod";
import { callsAiLimit } from "@/lib/calls/http";
import { createOwnerRequest, listCalls, scanForCalls, supabaseStore } from "@/lib/calls/service";
import { syncCallsAfter } from "@/lib/live/signal";
import { findSupplier } from "./suppliers";
import { ask, capped, changed, json, defineTool } from "../types";

const GROUPS: Record<string, string[]> = {
  pending: ["pending"],
  active: ["approved", "calling", "needs_input"],
  finished: ["completed", "failed"],
};

const limitMessage = (retryAfterSeconds: number) => `Error: Too many AI requests. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`;

export const callTools = [
  defineTool({
    name: "list_calls",
    tier: "read",
    area: "calls",
    description: "Supplier call requests, newest first. status: 'pending' (waiting for the owner's OK), 'active' (on the phone), 'finished', or 'all'.",
    input: z.object({ status: z.enum(["pending", "active", "finished", "all"]).optional() }),
    run: async ({ status }, ctx) => {
      const want = status && status !== "all" ? GROUPS[status] : null;
      const calls = (await listCalls(ctx.db, {})).filter((c) => !want || want.includes(c.status));
      return json(capped(calls.map((c) => ({ id: c.id, title: c.title, supplier: c.supplier.name, purpose: c.purpose, status: c.status, created_at: c.created_at, outcome: c.outcome }))));
    },
  }),
  defineTool({
    name: "get_call",
    tier: "read",
    area: "calls",
    description: "One supplier call: what it's for, what the caller may agree to, its progress or result. call_id comes from list_calls.",
    input: z.object({ call_id: z.number().int().positive() }),
    run: async ({ call_id }, ctx) => {
      const row = await supabaseStore(ctx.db).get(call_id);
      if (!row) return "Error: Unknown call request.";
      const r = row.result;
      return json({
        id: row.id, title: row.title, reason: row.reason, purpose: row.purpose, status: row.status, supplier_id: row.supplier_id,
        goal: row.brief.goal, may_agree_to: row.brief.limits, progress: row.progress, outcome: row.outcome,
        result: r ? { reached_person: r.reached_person, outcome: r.outcome, credit_amount: r.credit_amount, new_price: r.new_price, delivery_eta: r.delivery_eta, order_confirmed: r.order_confirmed, follow_up: r.follow_up } : null,
        error: row.error,
      });
    },
  }),
  defineTool({
    name: "propose_call",
    tier: "draft",
    area: "calls",
    description:
      "Propose a phone call to one of the restaurant's suppliers, when the owner asks for one (for example 'call Valley Butcher and ask if they can deliver Saturday'). " +
      "This only adds a request that the owner must review and approve on the Suppliers page; it does not call anyone. Tell the owner that. At most one per answer.",
    input: z.object({
      supplier: z.string().describe("The supplier's name as the owner said it"),
      request: z.string().min(3).max(1000).describe("What to ask or arrange on the call, in the owner's words"),
    }),
    run: async ({ supplier, request }, ctx) => {
      if (ctx.changes.some((c) => c.kind === "call_proposed")) return "Error: already proposed a call in this answer.";
      const found = await findSupplier(ctx.db, supplier);
      if (!found.ok) return ask(found.ask);
      const limited = callsAiLimit(ctx.identity);
      if (!limited.ok) return limitMessage(limited.retryAfterSeconds);
      const made = await createOwnerRequest(ctx.db, { supplier_id: found.item.id, text: request.trim() }, "ai");
      syncCallsAfter(ctx.db, [made.id], "/api/calls/request");
      return changed(ctx, {
        kind: "call_proposed",
        label: `Call request for ${found.item.name}: "${made.title}" (waiting for your OK on Suppliers, nothing dialed)`,
        before: null,
        after: made.id,
      });
    },
  }),
  defineTool({
    name: "scan_for_calls",
    tier: "draft",
    area: "calls",
    description: "Look for supplier calls worth making (billing errors to dispute, low stock to order by phone, price jumps to ask about). New ones wait for the owner's OK; nothing is dialed.",
    input: z.object({}),
    run: async (_input, ctx) => {
      const limited = callsAiLimit(ctx.identity);
      if (!limited.ok) return limitMessage(limited.retryAfterSeconds);
      const result = await scanForCalls(ctx.db);
      syncCallsAfter(ctx.db, result.created.map((c) => c.id), "/api/calls/scan");
      const no_phone = result.noPhone.map((n) => n.supplier_name);
      if (!result.created.length) return json({ ok: true, created: 0, considered: result.considered, no_phone });
      return changed(ctx, {
        kind: "calls_found",
        label: `Found ${result.created.length} call${result.created.length === 1 ? "" : "s"} to approve: ${result.created.map((c) => c.title).join("; ")}`,
        before: null,
        after: result.created.length,
      }, { no_phone });
    },
  }),
];
