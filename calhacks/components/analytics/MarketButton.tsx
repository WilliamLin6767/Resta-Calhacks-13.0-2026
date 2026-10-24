"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Asks the server to refresh USDA market quotes, then reloads the page.
export default function MarketButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function check() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/market/usda", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      if (body.message) setMessage(body.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={check}
        disabled={loading}
        className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
      >
        {loading ? "Checking USDA market..." : "Check USDA market"}
      </button>
      {message && <p className="max-w-sm text-right text-sm text-gray-500">{message}</p>}
      {error && <p className="max-w-sm text-right text-sm text-red-600">{error}</p>}
    </div>
  );
}
