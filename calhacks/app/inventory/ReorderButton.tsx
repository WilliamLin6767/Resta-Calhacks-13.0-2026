"use client";

import { useRouter } from "next/navigation";
import { useAction } from "@/components/useAction";

// Drafts orders to bring low items back to par, then shows them on the invoices page
export default function ReorderButton({ count }: { count: number }) {
  const router = useRouter();
  const { run, loading, error } = useAction();
  return (
    <div className="text-right">
      <button
        disabled={loading}
        onClick={() => run("/api/inventory/reorder", {}, () => router.push("/invoices#orders"))}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {loading ? "Drafting..." : `Draft orders for ${count} low ${count === 1 ? "item" : "items"}`}
      </button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
