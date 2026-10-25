"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Asks Claude for three posts, then reloads the page.
export default function DraftButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/draft", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 md:mr-28">
      <button
        onClick={draft}
        disabled={loading}
        className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {loading ? "Writing this week..." : "Draft this week"}
      </button>
      {loading && <p className="max-w-sm text-right text-sm text-gray-500">Reading Analytics and Trends, then writing the posts.</p>}
      {error && <p className="max-w-sm text-right text-sm text-red-600">{error}</p>}
    </div>
  );
}
