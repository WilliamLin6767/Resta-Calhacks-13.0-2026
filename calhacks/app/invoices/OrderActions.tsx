"use client";

import { useState } from "react";
import { useAction } from "@/components/useAction";
import { formatMoney } from "@/lib/format";
import type { OpenOrder } from "@/lib/purchasing/service";

const buttonClass = "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50 sm:w-auto";
const primaryClass = "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 sm:w-auto";

const STATUS_LABEL: Record<string, string> = { draft: "Waiting for your approval", approved: "Approved, not sent yet", sent: "Sent, waiting for delivery" };

// The buttons on one purchase order. Sending happens in the owner's own app (Messages, phone,
// email, WeChat...): this only fills in the message and records what the owner did.
// `part` lets the phone show Approve or Call first, and Cancel / Mark as sent after a tap.
export function OrderButtons({
  orderId, status, message, contact, part = "all",
}: { orderId: number; status: string; message: string; contact: { label: string; href: string | null }; part?: "all" | "primary" | "secondary" }) {
  const { run, loading, error } = useAction();
  const [copied, setCopied] = useState(false);
  const setStatus = (s: string) => run(`/api/purchase-orders/${orderId}/status`, { status: s });
  const showPrimary = part !== "secondary";
  const showSecondary = part !== "primary";

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {showPrimary && status === "draft" && (
        <button disabled={loading} onClick={() => setStatus("approved")} className={primaryClass}>
          Approve
        </button>
      )}
      {showPrimary && status === "approved" && (
        contact.href ? (
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
        )
      )}
      {status === "sent" && (part === "all" || part === "primary") && (
        <button disabled={loading} onClick={() => setStatus("received")} className={part === "primary" ? primaryClass : buttonClass}>
          Mark as delivered
        </button>
      )}
      {showSecondary && status === "approved" && (
        <button disabled={loading} onClick={() => setStatus("sent")} className={buttonClass}>
          Mark as sent
        </button>
      )}
      {showSecondary && (
        <button disabled={loading} onClick={() => setStatus("cancelled")} className={buttonClass}>
          Cancel order
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

function OrderDetails({ order }: { order: OpenOrder }) {
  return (
    <>
      {order.reason && <p className="mt-1 text-sm text-gray-700">{order.reason}</p>}
      <ul className="mt-2 text-sm">
        {order.lines.map((line, i) => (
          <li key={i} className="tabular-nums">
            {line.qty} x {line.ingredient}{line.pack_desc ? ` (${line.pack_desc})` : ""}
            {line.est_unit_price !== null && <span className="text-gray-500"> at {formatMoney(line.est_unit_price)}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-sm">
        About <span className="font-medium">{formatMoney(order.total)}</span> · {order.status === "sent" ? "expected" : "can arrive"} {order.delivery_date}
        {order.below_minimum > 0 && order.status !== "sent" && (
          <span className="ml-2 text-amber-700">
            {formatMoney(order.below_minimum)} below this supplier&apos;s {formatMoney(order.min_order_amount)} minimum
          </span>
        )}
      </p>
      {order.status !== "sent" && <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">&quot;{order.message}&quot;</p>}
    </>
  );
}

// Desktop shows the whole order. A phone shows the supplier, the status, and Approve or Call.
export function PurchaseOrderCard({ order }: { order: OpenOrder }) {
  const [open, setOpen] = useState(false);
  const buttons = { orderId: order.id, status: order.status, message: order.message, contact: order.contact };
  return (
    <div className={`rounded-lg border bg-white p-4 ${order.status === "draft" ? "border-amber-300" : "border-gray-200"}`}>
      <div className="hidden md:block">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium">
            {order.supplier}
            {order.created_by === "ai" && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">suggested by the app</span>}
          </p>
          <p className="text-sm text-gray-600">{STATUS_LABEL[order.status] ?? order.status}</p>
        </div>
        <OrderDetails order={order} />
        <div className="mt-3">
          <OrderButtons {...buttons} />
        </div>
      </div>

      <div className="md:hidden">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-start justify-between gap-3 text-left">
          <span>
            <span className="block font-medium">{order.supplier}</span>
            {order.reason && <span className="mt-0.5 line-clamp-2 text-sm font-normal text-gray-600">{order.reason}</span>}
          </span>
          <span className="shrink-0 text-sm text-gray-600">{STATUS_LABEL[order.status] ?? order.status}</span>
        </button>
        <div className="mt-3">
          <OrderButtons {...buttons} part="primary" />
        </div>
        {open && (
          <div className="mt-3">
            <OrderDetails order={order} />
            <div className="mt-3">
              <OrderButtons {...buttons} part="secondary" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
