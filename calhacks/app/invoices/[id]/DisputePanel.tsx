"use client";

import { useState } from "react";
import AiThinking from "@/components/ui/AiThinking";
import { useAction } from "@/components/useAction";
import { looksLikeEmail, mailtoLink } from "@/lib/purchasing/disputes";
import type { Dispute } from "@/lib/purchasing/disputeService";

const primary = "lift rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50";
const secondary = "rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";

function money(n: number) {
  return `$${Number(n).toFixed(2)}`;
}
function when(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}

// Billing errors -> a dispute email Claude drafts, the owner edits and sends from their own email,
// then tracks until the supplier credits it or says no.
export default function DisputePanel({ invoiceId, dispute, billedWrong, supplier }: {
  invoiceId: number; dispute: Dispute | null; billedWrong: number; supplier: string;
}) {
  const { run, loading, error } = useAction();
  const [to, setTo] = useState(dispute?.to_email ?? "");
  const [subject, setSubject] = useState(dispute?.subject ?? "");
  const [body, setBody] = useState(dispute?.body ?? "");
  const [saveEmail, setSaveEmail] = useState(!dispute?.to_email);
  const [credit, setCredit] = useState(dispute ? String(dispute.amount_claimed) : "");
  const [copied, setCopied] = useState(false);

  if (!dispute) {
    if (billedWrong <= 0) return null;
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-white p-4">
        <p className="text-sm">
          <span className="font-medium">{money(billedWrong)} billed wrong.</span> Claude can draft an email asking {supplier} for a credit. You check it and send it yourself.
        </p>
        <button disabled={loading} onClick={() => run(`/api/invoices/${invoiceId}/dispute`, undefined, undefined, { success: "Dispute email drafted" })} className={primary}>
          {loading ? "Drafting..." : "Draft a dispute email"}
        </button>
        {loading && <AiThinking label="Writing the dispute email..." className="w-full" />}
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </section>
    );
  }

  const edits = { to_email: to, subject, body };

  if (dispute.status === "draft") {
    return (
      <section className="rounded-lg border border-red-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Dispute email to {supplier}</h2>
          <p className="text-sm text-gray-600">Asking for {money(dispute.amount_claimed)} · drafted by AI, check it before sending</p>
        </div>
        <div className="mt-3 grid gap-2 text-sm">
          <label className="grid gap-1">
            To
            <input id="dispute-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="orders@supplier.com" className="rounded-md border border-gray-300 px-3 py-2" />
          </label>
          {!dispute.to_email && (
            <label className="flex items-center gap-2 text-gray-600">
              <input type="checkbox" checked={saveEmail} onChange={(e) => setSaveEmail(e.target.checked)} /> Save this address for {supplier}
            </label>
          )}
          <label className="grid gap-1">
            Subject
            <input id="dispute-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2" />
          </label>
          <label className="grid gap-1">
            Email
            <textarea id="dispute-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="rounded-md border border-gray-300 px-3 py-2 font-mono text-[13px] leading-relaxed" />
          </label>
        </div>
        <ol className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <li>
            <a
              href={looksLikeEmail(to) ? mailtoLink(to, subject, body) : undefined}
              aria-disabled={!looksLikeEmail(to)}
              className={`${primary} inline-block ${looksLikeEmail(to) ? "" : "pointer-events-none opacity-50"}`}
            >
              1. Open in my email
            </a>
          </li>
          <li>
            <button
              className={secondary}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "or copy it"}
            </button>
          </li>
          <li>
            <button disabled={loading || !looksLikeEmail(to)} onClick={() => run(`/api/disputes/${dispute.id}`, { action: "sent", ...edits, save_email: saveEmail }, undefined, { success: "Dispute marked as sent" })} className={primary}>
              2. I sent it
            </button>
          </li>
          <li>
            <button disabled={loading} onClick={() => run(`/api/disputes/${dispute.id}`, { action: "save", ...edits }, undefined, { success: "Dispute changes saved" })} className="text-sm text-gray-600 underline">
              Save changes for later
            </button>
          </li>
        </ol>
        {!looksLikeEmail(to) && <p className="mt-2 text-sm text-amber-700">Add {supplier}&apos;s email address to send it.</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>
    );
  }

  if (dispute.status === "sent") {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
        <p>
          <span className="font-medium">Dispute sent {dispute.sent_at ? when(dispute.sent_at) : ""}</span> to {dispute.to_email}, asking for {money(dispute.amount_claimed)}.
          Hold that amount back when paying this bill.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            $<input value={credit} onChange={(e) => setCredit(e.target.value)} inputMode="decimal" aria-label="Credit received" className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 tabular-nums" />
          </label>
          <button disabled={loading || !(Number(credit) > 0)} onClick={() => run(`/api/disputes/${dispute.id}`, { action: "credited", credited: Number(credit) }, undefined, { success: `Credit of ${money(Number(credit))} recorded` })} className={primary}>
            Credit received
          </button>
          <button disabled={loading} onClick={() => run(`/api/disputes/${dispute.id}`, { action: "refused" }, undefined, { success: "Dispute closed: no credit" })} className={secondary}>
            They said no
          </button>
        </div>
        {error && <p className="w-full text-red-600">{error}</p>}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-brand-100 bg-white p-4 text-sm">
      {dispute.status === "credited" ? (
        <p><span className="font-medium text-green-700">Credit of {money(dispute.amount_credited ?? 0)} received</span> from {supplier}{dispute.closed_at ? ` on ${when(dispute.closed_at)}` : ""}.</p>
      ) : (
        <p><span className="font-medium">{supplier} didn&apos;t give a credit</span> for the {money(dispute.amount_claimed)} disputed.</p>
      )}
    </section>
  );
}
