"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toaster";

// Small POST helper for buttons: runs `path`, then re-runs the server components so the page shows the result.
// With options.success, a working call shows that as a toast ("Invoice marked paid"); a failed call
// always shows its error as a toast too (and still returns it as `error`).
export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function run(path: string, body?: unknown, after?: (data: Record<string, unknown>) => void, options?: { success?: string }) {
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
        const message = data.error ?? "Something went wrong.";
        setError(message);
        toast({ message, tone: "error" });
        return;
      }
      after?.(data);
      router.refresh();
      if (options?.success) toast({ message: options.success, tone: "success" });
    } catch {
      setError("Could not reach the server.");
      toast({ message: "Could not reach the server.", tone: "error" });
    } finally {
      setLoading(false);
    }
  }
  return { run, loading, error };
}
