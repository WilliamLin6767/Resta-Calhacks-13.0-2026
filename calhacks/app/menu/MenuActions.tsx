"use client";

import { useState } from "react";
import { useAction } from "@/components/useAction";

const buttonClass = "rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";

// Approve the suggested price for one dish, or type a different one
export function ApprovePrice({ menuItemId, suggested, reason }: { menuItemId: number; suggested: number; reason: string }) {
  const { run, loading, error } = useAction();
  const [price, setPrice] = useState(suggested.toFixed(2));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-sm">
        $
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          aria-label="New price"
          className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums"
        />
      </label>
      <button
        disabled={loading || !(Number(price) > 0)}
        onClick={() =>
          run(`/api/menu-items/${menuItemId}/price`, { price: Number(price), reason }, undefined, { success: `Price set to $${Number(price).toFixed(2)}` })
        }
        className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? "Saving..." : "Approve"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// One checkbox: "I changed this price in DoorDash too"
export function MarkUpdated({ changeId, system, label, done }: { changeId: number; system: string; label: string; done: boolean }) {
  const { run, loading, error } = useAction();
  if (done) return <span className="text-xs text-green-700">✓ {label}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <button disabled={loading} onClick={() => run(`/api/price-changes/${changeId}/updated`, { system }, undefined, { success: `Marked as updated in ${label}` })} className={buttonClass}>
        {loading ? "..." : `Updated in ${label}`}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
