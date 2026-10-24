import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import { formatMoney } from "@/lib/format";
import { BILLING_ERROR_KINDS } from "@/lib/purchasing/checks";
import { latestDispute } from "@/lib/purchasing/disputeService";
import { formatUnitCost } from "@/lib/purchasing/units";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";
import DisputePanel from "./DisputePanel";
import { FlagButtons, LineFix, RecheckButton } from "./InvoiceActions";

// This page depends on the URL (/invoices/12), and the shared Sidebar reads the URL outside
// <Suspense>, so let this route wait for the URL instead of requiring an instant static shell.
// (The cleaner fix is wrapping <Sidebar /> in <Suspense> in app/layout.tsx.)
export const instant = false;

const SEVERITY = {
  high: { label: "Problem", className: "border-red-200 bg-red-50 text-red-800" },
  medium: { label: "Watch", className: "border-amber-200 bg-amber-50 text-amber-900" },
  info: { label: "Note", className: "border-blue-200 bg-blue-50 text-blue-900" },
} as const;

const MATCH_LABEL: Record<string, string> = {
  learned: "learned", seed: "matched", fuzzy: "matched", ai: "AI", ai_new: "new ingredient", manual: "confirmed",
};

async function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const supabase = await getSupabase();
  const [invRes, linesRes, flagsRes, ingRes, disputeRes] = await Promise.all([
    supabase.from("invoices").select("*, suppliers(name)").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle(),
    supabase.from("invoice_lines").select("*, ingredients(name, unit)").eq("invoice_id", id).order("id"),
    supabase.from("invoice_flags").select("*").eq("invoice_id", id).eq("resolved", false).order("id"),
    supabase.from("ingredients").select("id, name").eq("restaurant_id", RESTAURANT_ID).order("name"),
    latestDispute(supabase, id).then((d) => ({ data: d, error: null }), (e: Error) => ({ data: null, error: e })),
  ]);
  const error = invRes.error ?? linesRes.error ?? flagsRes.error ?? ingRes.error ?? disputeRes.error;
  if (error) return <ErrorMessage message={error.message} />;
  const inv = invRes.data;
  if (!inv) notFound();
  const lines = linesRes.data ?? [];
  const order = { high: 0, medium: 1, info: 2 } as const;
  const flags = (flagsRes.data ?? []).sort((a, b) => order[a.severity as keyof typeof order] - order[b.severity as keyof typeof order]);
  const billedWrong = flags.filter((f) => BILLING_ERROR_KINDS.has(f.kind)).reduce((s, f) => s + Number(f.money_impact ?? 0), 0);
  const supplier = inv.suppliers?.name ?? "Unknown supplier";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/invoices" className="text-sm text-gray-500 hover:underline">← Invoices</Link>
          <h1 className="text-2xl font-semibold">{supplier}</h1>
          <p className="text-gray-600">
            Invoice {inv.invoice_number ?? `#${inv.id}`} · {inv.invoice_date} · Total {formatMoney(inv.total)}
            {billedWrong > 0 && <span className="ml-2 font-medium text-red-600">{formatMoney(billedWrong)} billed wrong</span>}
          </p>
        </div>
        <RecheckButton invoiceId={inv.id} />
      </div>

      {/* key: a status change starts the panel fresh */}
      <DisputePanel key={`${disputeRes.data?.id}-${disputeRes.data?.status}`} invoiceId={inv.id} dispute={disputeRes.data} billedWrong={billedWrong} supplier={supplier} />

      <section className="space-y-2">
        {flags.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
            No open problems. Use &quot;Check this invoice&quot; to run the checks again.
          </p>
        ) : (
          flags.map((f) => {
            const s = SEVERITY[f.severity as keyof typeof SEVERITY];
            const dispute = BILLING_ERROR_KINDS.has(f.kind) && f.money_impact
              ? `Hi ${supplier}, on invoice ${inv.invoice_number ?? ""} (${inv.invoice_date}): ${f.message} Please send a credit for ${formatMoney(f.money_impact)}. Thank you!`
              : null;
            return (
              <div key={f.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${s.className}`}>
                <div className="min-w-0 flex-1">
                  <span className="mr-2 text-xs font-semibold uppercase tracking-wide">{s.label}</span>
                  {f.message}
                  {f.money_impact != null && f.kind !== "price_down" && <span className="ml-1 font-semibold">{formatMoney(f.money_impact)}</span>}
                </div>
                <FlagButtons flagId={f.id} kind={f.kind} disputeNote={dispute} />
              </div>
            );
          })
        )}
      </section>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-2 font-medium">As printed → ingredient</th>
              <th className="px-4 py-2 text-right font-medium">Ordered / delivered</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
              <th className="px-4 py-2 text-right font-medium">Line total</th>
              <th className="px-4 py-2 text-right font-medium">Unit cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const printed = l.printed_total ?? l.line_total;
              const unit = l.ingredients?.unit ?? "";
              const unitCost = l.pack_qty ? Number(l.unit_price) / Number(l.pack_qty) : null;
              return (
                <tr key={l.id} className="border-t border-gray-100 align-top">
                  <td className="px-4 py-2">
                    <div className="font-mono text-xs text-gray-600">{l.description}</div>
                    <div>
                      → {l.ingredients?.name ?? <span className="text-amber-700">not matched</span>}
                      {l.match_source && (
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${l.needs_review ? "bg-amber-50 text-amber-800" : "bg-gray-100 text-gray-600"}`}>
                          {l.needs_review && l.match_source !== "ai_new" ? "check this" : MATCH_LABEL[l.match_source] ?? l.match_source}
                        </span>
                      )}
                    </div>
                    {l.needs_review && (
                      <LineFix lineId={l.id} ingredients={ingRes.data ?? []} suggestedName={l.match_source === "ai_new" ? l.ingredients?.name ?? "" : ""} />
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {l.qty_ordered != null && Number(l.qty_ordered) !== Number(l.qty) ? `${l.qty_ordered} / ` : ""}{l.qty}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.unit_price)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(printed)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{unitCost != null && unit ? formatUnitCost(unitCost, unit) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {inv.notes && <p className="text-sm text-gray-600">Notes on the invoice: {inv.notes}</p>}
    </div>
  );
}

// The URL's [id] is read inside <Suspense>, as Cache Components requires.
export default function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Loading...</p>}>
      <Invoice params={params} />
    </Suspense>
  );
}
