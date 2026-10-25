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

// "Check email now": asks the Gmail script to send new mail right away instead of within the minute.
// The AI then reads each email (5-20 seconds), so the page refreshes a few times after.
export function CheckEmailNow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  async function check() {
    setBusy(true);
    setNote("");
    setError("");
    try {
      const data = await post("/api/inbound/check");
      if (data.busy) setNote("Already checking. New mail will show in a few seconds.");
      else if (!data.sent) setNote("No new email yet. If you just sent it, give Gmail a few seconds and check again.");
      else setNote(`Found ${data.sent} new email${data.sent === 1 ? "" : "s"}. Reading ${data.sent === 1 ? "it" : "them"} now...`);
      if (data.sent || data.busy) for (const ms of [4000, 9000, 16000, 25000]) setTimeout(() => router.refresh(), ms);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button className={primary} disabled={busy} onClick={check}>{busy ? "Checking Gmail..." : "Check email now"}</button>
      {note && <span className="text-sm text-gray-600">{note}</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  );
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
        <button className={secondary} disabled={!!busy} onClick={() => run("order")}>Try a sample catering request</button>
      </div>
      {busy && <div className="mt-3"><AiThinking label={busy === "invoice" ? "Reading the emailed invoice... (about 20 seconds)" : "Reading the catering request..."} /></div>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export type InboxAction = "read" | "confirm" | "picked-up" | "register" | "decline" | "cancel";

const LABEL: Record<InboxAction, string> = {
  read: "Read the invoice",
  confirm: "Accept the order",
  "picked-up": "Picked up and paid",
  register: "Rang up at the register",
  decline: "Decline",
  cancel: "Cancel the order",
};

// The owner's buttons on one email: read an unknown sender's invoice; accept or decline an order;
// then, once it's paid for, record it here (picked up) or close it (rung up at the register)
export function InboxButtons({ id, actions, replyHref }: { id: number; actions: InboxAction[]; replyHref?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function run(action: InboxAction) {
    setBusy(action);
    setError("");
    try {
      const data = await post(`/api/inbound/${id}/${action === "cancel" ? "decline" : action}`);
      if (action === "read" && data.invoice_id) router.push(`/invoices/${data.invoice_id}`);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {actions.map((a, i) => (
        <button key={a} className={i === 0 ? primary : secondary} disabled={!!busy} onClick={() => run(a)}>
          {busy === a ? "Saving..." : LABEL[a]}
        </button>
      ))}
      {replyHref && <a href={replyHref} className="text-sm text-brand-700 underline">Email the customer a confirmation</a>}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
