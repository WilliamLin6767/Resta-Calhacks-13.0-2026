"use client";

import { useState } from "react";
import { useAction } from "@/components/useAction";

const buttonClass = "rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";

export function CopyNote({ text, label = "Copy note to the app's support" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={buttonClass}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function MarkPaid({ invoiceId }: { invoiceId: number }) {
  const { run, loading, error } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={loading} onClick={() => run(`/api/invoices/${invoiceId}/paid`, undefined, undefined, { success: "Invoice marked paid" })} className={buttonClass}>
        {loading ? "Saving..." : "Mark paid"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

// Pick dates, then download the CSV (the browser saves the file)
export function QuickbooksExport({ defaultFrom, defaultTo }: { defaultFrom: string; defaultTo: string }) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const valid = from && to && from <= to;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        From
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-2 rounded-md border border-gray-300 px-2 py-1" />
      </label>
      <label className="text-sm">
        To
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ml-2 rounded-md border border-gray-300 px-2 py-1" />
      </label>
      <a
        href={valid ? `/api/accounting/quickbooks?from=${from}&to=${to}` : undefined}
        aria-disabled={!valid}
        className={`lift rounded-md px-4 py-2 text-sm font-medium text-white ${valid ? "bg-brand-600 hover:bg-brand-700" : "pointer-events-none bg-gray-400"}`}
      >
        Download for QuickBooks
      </a>
    </div>
  );
}
