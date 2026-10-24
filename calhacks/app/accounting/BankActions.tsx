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

// The owner approves the move: nothing moves until they press the button
export function MoveToSavings({ suggested }: { suggested: number }) {
  const { run, loading, error } = useAction();
  const [value, setValue] = useState(String(suggested));
  const amount = Number(value);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm">
          $<input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" aria-label="Amount to move to savings"
            className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 tabular-nums" />
        </label>
        <button disabled={loading || !(Number.isInteger(amount) && amount > 0)} onClick={() => run("/api/bank/savings", { amount })}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {loading ? "Moving..." : "Move to savings"}
        </button>
      </div>
      {amount > suggested && <p className="mt-1 text-xs text-amber-700">More than the suggested amount: the forecast may dip below your reserve.</p>}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function UndoMove() {
  const { run, loading, error } = useAction();
  return (
    <span>
      <button disabled={loading} onClick={() => run("/api/bank/savings/undo")} className="text-sm text-brand-700 underline disabled:opacity-50">
        {loading ? "Undoing..." : "Undo the last move"}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  );
}
