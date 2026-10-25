import Link from "next/link";
import ErrorMessage from "@/components/ErrorMessage";
import { confirmationEmail, loadInbox, type InboxRow } from "@/lib/email/service";
import { formatMoney } from "@/lib/format";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";
import { InboxButtons, SampleEmails } from "./InboxActions";

const STATUS: Record<InboxRow["status"], { label: string; className: string }> = {
  new: { label: "Reading", className: "bg-gray-100 text-gray-700" },
  done: { label: "Added", className: "bg-green-50 text-green-800" },
  needs_review: { label: "Check the sender", className: "bg-amber-50 text-amber-800" },
  to_confirm: { label: "Confirm", className: "bg-red-50 text-red-700" },
  confirmed: { label: "Confirmed", className: "bg-green-50 text-green-800" },
  declined: { label: "Declined", className: "bg-gray-100 text-gray-600" },
  ignored: { label: "Skipped", className: "bg-gray-100 text-gray-600" },
  error: { label: "Couldn't read", className: "bg-red-50 text-red-700" },
};
const KIND = { supplier_invoice: "Supplier invoice", customer_order: "Customer order", other: "Other", unknown: "Email" };

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Row({ e, restaurant }: { e: InboxRow; restaurant: string }) {
  const o = e.customer_order;
  const actions: ("read" | "confirm" | "decline")[] =
    e.status === "to_confirm" ? ["confirm", "decline"] : e.status === "needs_review" && e.kind === "supplier_invoice" ? ["read", "decline"] : e.status === "needs_review" ? ["decline"] : [];
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS[e.status].className}`}>{STATUS[e.status].label}</span>
        <span className="font-medium text-gray-900">{KIND[e.kind]}</span>
        <span className="text-gray-600">from {e.from_name || e.from_email}</span>
        {e.subject && <span className="text-gray-500">· {e.subject}</span>}
        <span className="ml-auto text-xs text-gray-400">{when(e.created_at)}</span>
      </div>
      {e.note && <p className="mt-1 text-sm text-gray-600">{e.note}</p>}
      {o && o.lines.length > 0 && (
        <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <ul className="grid gap-0.5">
            {o.lines.map((l) => (
              <li key={l.menu_item_id} className="flex justify-between gap-3"><span>{l.qty} x {l.name}</span><span className="tabular-nums">{formatMoney(l.qty * l.unit_price)}</span></li>
            ))}
          </ul>
          <p className="mt-1 flex justify-between border-t border-gray-200 pt-1 font-medium"><span>Total</span><span className="tabular-nums">{formatMoney(o.total)}</span></p>
          {(o.pickup_date || o.pickup_time) && <p className="mt-1 text-gray-600">Pickup: {[o.pickup_date, o.pickup_time].filter(Boolean).join(" at ")}</p>}
          {o.notes && <p className="text-gray-600">Note: {o.notes}</p>}
          {o.unmatched.length > 0 && <p className="text-amber-800">Not on the menu: {o.unmatched.join(", ")}</p>}
        </div>
      )}
      {e.invoice_id && <Link href={`/invoices/${e.invoice_id}`} className="mt-1 inline-block text-sm text-brand-700 underline">Open the invoice</Link>}
      {(actions.length > 0 || e.status === "confirmed") && (
        <InboxButtons id={e.id} actions={actions} replyHref={o && o.lines.length ? confirmationEmail(o, restaurant) : undefined} />
      )}
    </li>
  );
}

// Invoices and customer orders that came in by email, newest first
export default async function EmailInbox() {
  let rows: InboxRow[];
  let restaurant = "our restaurant";
  try {
    const db = await getSupabase();
    const [inbox, r] = await Promise.all([loadInbox(db), db.from("restaurants").select("name").eq("id", RESTAURANT_ID).maybeSingle()]);
    rows = inbox;
    restaurant = (r.data as { name: string } | null)?.name ?? restaurant;
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  const address = process.env.INBOUND_EMAIL_ADDRESS;
  return (
    <section className="mb-8 rounded-2xl border border-brand-100 bg-white p-5">
      <h2 className="font-semibold">Email inbox</h2>
      <p className="mb-3 text-sm text-gray-600">
        Invoices from your suppliers are read and added on their own. Customer orders wait here for you to confirm, and an invoice from an
        address that isn&apos;t one of your suppliers waits for you to check it.
        {address ? <> Forward or send them to <span className="font-medium text-gray-900">{address}</span>.</> : null}
      </p>
      <SampleEmails />
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No emails yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">{rows.map((e) => <Row key={e.id} e={e} restaurant={restaurant} />)}</ul>
      )}
    </section>
  );
}
