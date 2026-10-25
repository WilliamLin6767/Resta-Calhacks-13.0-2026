"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toaster";
import { useAction } from "@/components/useAction";

export function SetupBank() {
  const { run, loading, error } = useAction();
  return (
    <div>
      <button disabled={loading} onClick={() => run("/api/bank/setup", undefined, undefined, { success: "Capital One Nessie account connected" })} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {loading ? "Opening the Nessie account..." : "Connect a Capital One Nessie account"}
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
        <button disabled={loading || !(Number(value) >= 0)} onClick={() => run("/api/bank/reserve", { amount: Number(value) }, undefined, { success: `Reserve set to $${Number(value).toLocaleString("en-US")}` })} className="text-sm text-brand-700 underline">
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
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(String(suggested));
  const amount = Number(value);

  // The toast's Undo: the same call as "Undo the last move" (UndoMove below). It doesn't touch this
  // component's state, since the refresh after a move may have replaced this button already.
  async function undo() {
    try {
      const res = await fetch("/api/bank/savings/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      router.refresh();
      toast({ message: "Move undone: the money is back in the account", tone: "success" });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Could not reach the server.", tone: "error" });
    }
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm">
          $<input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" aria-label="Amount to move to savings"
            className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 tabular-nums" />
        </label>
        <button disabled={loading || !(Number.isInteger(amount) && amount > 0)} onClick={() =>
            run("/api/bank/savings", { amount }, () =>
              toast({ message: `Moved $${amount.toLocaleString("en-US")} to savings`, tone: "success", action: { label: "Undo", onClick: undo } }),
            )
          }
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
      <button disabled={loading} onClick={() => run("/api/bank/savings/undo", undefined, undefined, { success: "Last move undone" })} className="text-sm text-brand-700 underline disabled:opacity-50">
        {loading ? "Undoing..." : "Undo the last move"}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  );
}
