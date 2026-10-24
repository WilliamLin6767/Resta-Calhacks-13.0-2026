"use client";

import { useState } from "react";
import { useAction } from "@/components/useAction";

const buttonClass = "rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50";
const primaryClass = "lift rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50";

// The buttons on one purchase order. Sending happens in the owner's own app (Messages, phone,
// email, WeChat...): this only fills in the message and records what the owner did.
export function OrderButtons({
  orderId, status, message, contact,
}: { orderId: number; status: string; message: string; contact: { label: string; href: string | null } }) {
  const { run, loading, error } = useAction();
  const [copied, setCopied] = useState(false);
  const setStatus = (s: string) => run(`/api/purchase-orders/${orderId}/status`, { status: s });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <button disabled={loading} onClick={() => setStatus("approved")} className={primaryClass}>
          Approve
        </button>
      )}
      {status === "approved" && (
        <>
          {contact.href ? (
            <a href={contact.href} className={primaryClass}>{contact.label}</a>
          ) : (
            <button
              className={primaryClass}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : contact.label}
            </button>
          )}
          <button disabled={loading} onClick={() => setStatus("sent")} className={buttonClass}>
            Mark as sent
          </button>
        </>
      )}
      {status === "sent" && (
        <button disabled={loading} onClick={() => setStatus("received")} className={buttonClass}>
          Mark as delivered
        </button>
      )}
      <button disabled={loading} onClick={() => setStatus("cancelled")} className={buttonClass}>
        Cancel order
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
