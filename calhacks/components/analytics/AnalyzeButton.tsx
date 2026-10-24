"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Asks the server to write a new AI report, then reloads the page data to show it.
export default function AnalyzeButton({ days }: { days: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/analytics/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      // When the server reused a recent report, it says so in `message`.
      const body = await res.json();
      if (body.cached) setMessage(body.message);
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
        onClick={analyze}
        disabled={loading}
        className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
      >
        {loading ? "Analyzing... (up to 30 seconds)" : "Analyze with AI"}
      </button>
      {message && <p className="max-w-sm text-right text-sm text-gray-500">{message}</p>}
      {error && <p className="max-w-sm text-right text-sm text-red-600">{error}</p>}
    </div>
  );
}
