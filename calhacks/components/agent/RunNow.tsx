"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Report = { detected: string[]; skipped: string[]; proposed: number[]; failed: { id: number; error: string }[]; measuring: number[]; dismissed: number[]; closed: number[]; errors: string[] };

function summary(r: Report) {
  const parts = [
    r.detected.length ? `${r.detected.length} new case${r.detected.length === 1 ? "" : "s"}` : "",
    r.proposed.length ? `${r.proposed.length} proposal${r.proposed.length === 1 ? "" : "s"} for you` : "",
    r.measuring.length ? `${r.measuring.length} now being measured` : "",
    r.closed.length ? `${r.closed.length} report${r.closed.length === 1 ? "" : "s"} ready` : "",
    r.failed.length ? `${r.failed.length} couldn't be investigated` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "Nothing new. Resta checked every playbook.";
}

// "Run now": one tick of the loop on demand (the same as the cron). Resta looks for problems,
// investigates up to three and proposes actions for the owner to approve.
export default function RunNow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/loop/run", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The loop couldn't run.");
      setNote(summary(body as Report));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The loop couldn't run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <button type="button" onClick={run} disabled={busy} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? "Looking for problems..." : "Run now"}
      </button>
      {busy && <p className="text-sm text-gray-500">Checking every playbook and investigating up to three cases. This takes a minute.</p>}
      {note && <p className="text-sm text-gray-700">{note}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
