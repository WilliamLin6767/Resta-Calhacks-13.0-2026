"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// One tap puts a recommended dish on the menu.
export default function AddToMenuButton({ dishName, onMenu }: { dishName: string; onMenu: boolean }) {
  const router = useRouter();
  const [added, setAdded] = useState(onMenu);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/market/trends/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dish_name: dishName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setAdded(true);
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
        type="button"
        onClick={approve}
        disabled={added || loading}
        className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {added ? "On the menu" : loading ? "Adding..." : "Add to menu"}
      </button>
      {error && <p className="max-w-xs text-right text-sm text-red-600">{error}</p>}
    </div>
  );
}
