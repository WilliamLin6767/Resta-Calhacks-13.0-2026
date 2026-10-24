"use client";

// "Check for calls" (runs detection) and "Request a call" (the owner's own words).
// Both only create pending requests; nothing dials until the owner approves one.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toaster";
import { announceCallsChanged } from "./CallRequests";

const primary = "rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50";

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

type ScanResult = { created: { id: number; title: string }[]; considered: number; noPhone: { supplier_name: string; summary: string }[] };

export function CheckForCalls() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  async function scan() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const found: ScanResult = await post("/api/calls/scan", {});
      setResult(found);
      announceCallsChanged();
      router.refresh();
      toast({
        message: found.created.length ? `${found.created.length} new call${found.created.length === 1 ? "" : "s"} to review` : "Checked: nothing needs a call",
        tone: found.created.length ? "success" : "info",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast({ message: err instanceof Error ? err.message : String(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button className={primary} disabled={busy} onClick={scan}>
        {busy ? "Checking..." : "Check for calls"}
      </button>
      <div aria-live="polite" className="text-sm">
        {result && (
          <p className="text-gray-700">
            {result.created.length
              ? `${result.created.length} new call${result.created.length === 1 ? "" : "s"} to review below.`
              : result.considered
                ? "Nothing worth a call right now."
                : "Nothing found that needs a call."}
          </p>
        )}
        {result?.noPhone.length ? (
          <ul className="mt-1 text-gray-600">
            {result.noPhone.map((n, i) => (
              <li key={i}>No phone on file for {n.supplier_name}: {n.summary}.</li>
            ))}
          </ul>
        ) : null}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </div>
  );
}

export function RequestCall({ suppliers }: { suppliers: { id: number; name: string; has_phone: boolean }[] }) {
  const router = useRouter();
  const toast = useToast();
  const callable = suppliers.filter((s) => s.has_phone);
  const [supplierId, setSupplierId] = useState(callable[0]?.id ?? 0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const made = await post("/api/calls/request", { supplier_id: supplierId, text });
      setMessage(`Added "${made.title}". It's at the top of Supplier calls above: check it, then approve to call.`);
      setText("");
      announceCallsChanged();
      router.refresh();
      toast({ message: "Call request added", tone: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast({ message: err instanceof Error ? err.message : String(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const field = "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm";
  return (
    <form onSubmit={submit} className="space-y-2 rounded-2xl border border-brand-100 bg-white p-4">
      <h2 className="text-lg font-semibold">Request a call</h2>
      <p className="text-sm text-gray-600">Say what you want asked. The AI writes the call plan; nothing is dialed until you approve it.</p>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="call-supplier">Supplier</label>
        <select id="call-supplier" className={field} value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id} disabled={!s.has_phone}>
              {s.name}{s.has_phone ? "" : " (no phone on file)"}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="call-text">What to ask</label>
        <input
          id="call-text"
          className={`${field} min-w-0 flex-1`}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. ask if they can deliver extra brisket Saturday"
        />
        <button className={primary} disabled={busy || text.trim().length < 3 || !supplierId}>
          {busy ? "Writing..." : "Add request"}
        </button>
      </div>
      <p aria-live="polite" className="text-sm text-gray-700">{message}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
  );
}

// A small count badge, e.g. next to an invoice in a list.
export function CallBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
      {count} call{count === 1 ? "" : "s"} to approve
    </span>
  );
}
