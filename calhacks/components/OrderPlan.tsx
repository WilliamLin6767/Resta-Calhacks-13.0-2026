"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Plan } from "@/lib/purchasing/plan";
import type { PlanExplanation } from "@/lib/purchasing/planAi";

const primary = "rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50";
const secondary = "rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";

function money(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function day(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// "Plan orders": compares suppliers for everything needed (code), explains the plan (AI),
// and drafts one order per supplier when the owner agrees. `request` is sent to /api/orders/plan.
export default function OrderPlan({ request, label }: { request: Record<string, unknown>; label: string }) {
  const router = useRouter();
  const [data, setData] = useState<{ plan: Plan; explanation: PlanExplanation | null; explain_error: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function post(path: string) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
    return body;
  }
  async function plan() {
    setBusy("Comparing suppliers...");
    setError("");
    try {
      setData(await post("/api/orders/plan"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function draft() {
    setBusy("Drafting orders...");
    setError("");
    try {
      await post("/api/orders/plan/draft");
      router.push("/invoices#orders");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }

  if (!data) {
    return (
      <div className="text-right">
        <button disabled={!!busy} onClick={plan} className={primary}>{busy || label}</button>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  const { plan: p, explanation: ex } = data;
  const notes = new Map((ex?.suppliers ?? []).map((s) => [s.supplier_id, s.note]));
  return (
    <div className="mt-3 w-full rounded-lg border border-gray-200 bg-white p-4 text-left">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Order plan</h3>
        <p className="text-sm tabular-nums">
          {money(p.total)}
          {p.savings > 0.5 && <span className="ml-2 text-green-700">{money(p.savings)} less than your usual suppliers</span>}
        </p>
      </div>
      {ex ? (
        <div className="mt-2 rounded-md bg-gray-50 p-3 text-sm">
          <p><span className="mr-2 text-xs font-semibold uppercase tracking-wide text-gray-500">AI</span>{ex.summary}</p>
          {ex.next_steps.length > 0 && <ul className="mt-1 list-disc pl-5 text-gray-700">{ex.next_steps.map((s) => <li key={s}>{s}</li>)}</ul>}
        </div>
      ) : (
        data.explain_error && <p className="mt-2 text-sm text-gray-500">No AI explanation this time ({data.explain_error}). The plan below is still worked out.</p>
      )}
      <div className="mt-3 grid gap-3">
        {p.groups.map((g) => (
          <div key={g.supplier_id} className="rounded-md border border-gray-200 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">{g.supplier}</p>
              <p className="tabular-nums text-gray-600">
                {money(g.total)} · arrives {day(g.arrives)}
                {g.late && <span className="ml-2 text-red-700">after it&apos;s needed</span>}
              </p>
            </div>
            {g.below_minimum > 0 && <p className="text-amber-700">{money(g.below_minimum)} under their {money(g.min_order_amount)} minimum</p>}
            {notes.get(g.supplier_id) && <p className="mt-1 text-gray-600">{notes.get(g.supplier_id)}</p>}
            <ul className="mt-2 grid gap-1">
              {g.lines.map((l) => (
                <li key={l.ingredient_id} className="tabular-nums">
                  {l.choice.packs} x {l.name}{l.choice.pack_desc ? ` (${l.choice.pack_desc})` : ""} · {money(l.choice.cost)}
                  {l.options.length > 1 && (
                    <span className="block text-xs text-gray-500">
                      Also: {l.options.filter((o) => o.supplier_id !== l.choice.supplier_id).map((o) => `${o.supplier} ${money(o.cost)}, ${day(o.arrives)}`).join(" · ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {p.cant_order.length > 0 && <p className="mt-2 text-sm text-amber-700">No supplier has a price for: {p.cant_order.map((n) => n.name).join(", ")}.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {p.groups.length > 0 && (
          <button disabled={!!busy} onClick={draft} className={primary}>
            {busy || `Draft ${p.groups.length} ${p.groups.length === 1 ? "order" : "orders"} for approval`}
          </button>
        )}
        <button disabled={!!busy} onClick={() => setData(null)} className={secondary}>Close</button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
