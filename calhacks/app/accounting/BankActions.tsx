"use client";

import { useState } from "react";
import { useAction } from "@/components/useAction";

export function SetupBank() {
  const { run, loading, error } = useAction();
  return (
    <div>
      <button disabled={loading} onClick={() => run("/api/bank/setup")} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {loading ? "Setting up the simulated account..." : "Connect a simulated bank account"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function ReserveInput({ reserve }: { reserve: number }) {
  const { run, loading, error } = useAction();
  const [value, setValue] = useState(String(reserve));
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1">
        $<input id="cash-reserve" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" aria-label="Cash reserve"
          className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 tabular-nums" />
      </label>
      {Number(value) !== reserve && (
        <button disabled={loading || !(Number(value) >= 0)} onClick={() => run("/api/bank/reserve", { amount: Number(value) })} className="text-sm text-brand-700 underline">
          {loading ? "Saving..." : "Save"}
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
