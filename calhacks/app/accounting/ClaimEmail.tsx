"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Draft = { key: string; title: string; to: string; subject: string; body: string; appName: string };
type State = { status: "sent" | "opened" | "rejected" | "failed"; to: string; at: string; error?: string } | null;

const primary = "rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50";
const secondary = "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";
const field = "w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900";

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// The drafted email to a delivery app's support, for the owner to approve (it's sent) or reject.
// Nothing goes out until they press Approve and send.
export default function ClaimEmail({ draft, state, canSend }: { draft: Draft; state: State; canSend: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(draft.to);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState<"" | "send" | "reject">("");
  const [error, setError] = useState("");
  const [redraft, setRedraft] = useState(false);

  async function decide(decision: "send" | "reject") {
    setBusy(decision);
    setError("");
    try {
      const res = await fetch("/api/payout-claims", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, claim_key: draft.key, title: draft.title, to, subject, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      if (data.mailto) window.location.href = data.mailto; // no Gmail script: send it from the owner's mail app
      setRedraft(false);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  // Already handled: say what happened, with a way to draft it again
  if (state && state.status !== "failed" && !redraft) {
    const label = state.status === "sent" ? `Email sent to ${state.to}` : state.status === "opened" ? `Email opened to send to ${state.to}` : "You decided not to email them";
    return (
      <span className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
        <span className={state.status === "rejected" ? "text-gray-500" : "font-medium text-green-700"}>{label} · {when(state.at)}</span>
        <button className="text-sm text-gray-600 underline hover:text-gray-900" onClick={() => setRedraft(true)}>Draft again</button>
      </span>
    );
  }

  if (!open) {
    return (
      <span className="flex shrink-0 flex-wrap items-center gap-2">
        {state?.status === "failed" && <span className="text-sm text-red-700">Last try didn&apos;t send.</span>}
        <button className={primary} onClick={() => setOpen(true)}>Review email to {draft.appName}</button>
      </span>
    );
  }

  return (
    <div className="mt-2 w-full basis-full rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Drafted for you · nothing is sent until you approve</p>
      <label className="mb-2 block">
        <span className="text-xs text-gray-500">To ({draft.appName} support)</span>
        <input className={field} value={to} onChange={(e) => setTo(e.target.value)} placeholder="support@..." inputMode="email" />
      </label>
      <label className="mb-2 block">
        <span className="text-xs text-gray-500">Subject</span>
        <input className={field} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-xs text-gray-500">Message</span>
        <textarea className={`${field} min-h-32`} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={primary} disabled={!!busy || !to.trim()} onClick={() => decide("send")}>
          {busy === "send" ? "Sending..." : canSend ? "Approve and send" : "Approve and open in my email"}
        </button>
        <button className={secondary} disabled={!!busy} onClick={() => decide("reject")}>{busy === "reject" ? "Saving..." : "Reject"}</button>
        <button className="text-sm text-gray-500 hover:text-gray-800" onClick={() => setOpen(false)}>Close</button>
        {canSend && <span className="text-xs text-gray-500">Sends from the restaurant&apos;s Gmail.</span>}
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
