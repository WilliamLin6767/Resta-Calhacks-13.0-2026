"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Small POST helper for buttons: runs `path`, then re-runs the server components so the page shows the result.
export function useAction() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function run(path: string, body?: unknown, after?: (data: Record<string, unknown>) => void) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      after?.(data);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }
  return { run, loading, error };
}
