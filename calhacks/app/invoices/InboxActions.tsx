"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import AiThinking from "@/components/ui/AiThinking";

const primary = "rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50";
const secondary = "rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";

async function post(path: string, body?: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

// Runs a made-up email through the real inbox
export function SampleEmails() {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "invoice" | "order">("");
  const [error, setError] = useState("");
  async function run(kind: "invoice" | "order") {
    setBusy(kind);
    setError("");
    try {
      await post("/api/inbound/sample", { kind });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button className={secondary} disabled={!!busy} onClick={() => run("invoice")}>Try a sample supplier email</button>
        <button className={secondary} disabled={!!busy} onClick={() => run("order")}>Try a sample customer order</button>
      </div>
      {busy && <div className="mt-3"><AiThinking label={busy === "invoice" ? "Reading the emailed invoice... (about 20 seconds)" : "Reading the customer's email..."} /></div>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

// The owner's buttons on one email: read an unknown sender's invoice, or confirm/decline an order
export function InboxButtons({ id, actions, replyHref }: { id: number; actions: ("read" | "confirm" | "decline")[]; replyHref?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  async function run(action: "read" | "confirm" | "decline") {
    setBusy(action);
    setError("");
    try {
      const data = await post(`/api/inbound/${id}/${action}`);
      if (action === "read" && data.invoice_id) router.push(`/invoices/${data.invoice_id}`);
      else {
        if (action === "confirm") setConfirmed(true);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  const label = { read: "Read the invoice", confirm: "Confirm the order", decline: "Decline" };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {actions.map((a, i) => (
        <button key={a} className={i === 0 ? primary : secondary} disabled={!!busy} onClick={() => run(a)}>
          {busy === a ? "Saving..." : label[a]}
        </button>
      ))}
      {(confirmed || (replyHref && !actions.length)) && replyHref && (
        <a href={replyHref} className="text-sm text-brand-700 underline">Email the customer a confirmation</a>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
