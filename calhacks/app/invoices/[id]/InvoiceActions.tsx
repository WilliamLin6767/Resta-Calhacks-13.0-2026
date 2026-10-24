"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/components/useAction";

const buttonClass = "rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";

// Buttons on one problem: mark it done, draft an order with the cheaper supplier, copy a dispute note
export function FlagButtons({ flagId, kind, disputeNote }: { flagId: number; kind: string; disputeNote: string | null }) {
  const { run, loading, error } = useAction();
  const router = useRouter(); // after drafting an order, go to it on the invoices page
  const [done, setDone] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {kind === "cheaper_elsewhere" && (
        <button
          disabled={loading}
          onClick={() => run(`/api/invoice-flags/${flagId}/order`, {}, () => router.push("/invoices/orders"), { success: "Order drafted with the cheaper supplier" })}
          className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Draft an order there
        </button>
      )}
      {disputeNote && (
        <button
          className={buttonClass}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(disputeNote);
              setDone("Dispute note copied");
            } catch {
              setDone(disputeNote);
            }
          }}
        >
          Copy dispute note
        </button>
      )}
      <button disabled={loading} onClick={() => run(`/api/invoice-flags/${flagId}/resolve`, undefined, undefined, { success: "Problem marked done" })} className={buttonClass}>
        Done
      </button>
      {done && <span className="text-xs text-green-700">{done}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// For a line that isn't matched for sure: pick the right ingredient, or name a new one
export function LineFix({
  lineId, ingredients, suggestedName,
}: { lineId: number; ingredients: { id: number; name: string }[]; suggestedName: string }) {
  const { run, loading, error } = useAction();
  const [pick, setPick] = useState("");
  const [name, setName] = useState(suggestedName);
  const [unit, setUnit] = useState("lb");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        aria-label="Which ingredient is this?"
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs"
      >
        <option value="">It&apos;s actually...</option>
        {ingredients.map((i) => (
          <option key={i.id} value={i.id}>{i.name}</option>
        ))}
      </select>
      {!pick && (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="or a new ingredient"
            aria-label="New ingredient name"
            className="w-40 rounded-md border border-gray-300 px-2 py-1 text-xs"
          />
          <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit" className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs">
            {["lb", "oz", "ea", "bunch", "can", "head"].map((u) => <option key={u}>{u}</option>)}
          </select>
        </>
      )}
      <button
        disabled={loading || (!pick && !name.trim())}
        onClick={() =>
          run(`/api/invoice-lines/${lineId}/confirm`, pick ? { ingredient_id: Number(pick) } : { new_ingredient_name: name, new_ingredient_unit: unit }, undefined, {
            success: pick ? `Line matched to ${ingredients.find((i) => String(i.id) === pick)?.name ?? "the ingredient"}` : `Added ${name.trim()} as a new ingredient`,
          })
        }
        className={buttonClass}
      >
        {loading ? "Saving..." : "Confirm"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// Re-run matching (AI for unmatched lines) and every check on this invoice
export function RecheckButton({ invoiceId }: { invoiceId: number }) {
  const { run, loading, error } = useAction();
  return (
    <div>
      <button
        disabled={loading}
        onClick={() => run(`/api/invoices/${invoiceId}/check`, undefined, undefined, { success: "Invoice checked again" })}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? "Checking..." : "Check this invoice"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
