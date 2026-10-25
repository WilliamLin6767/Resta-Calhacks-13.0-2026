import Link from "next/link";
import ErrorMessage from "@/components/ErrorMessage";
import PreviewSection from "@/components/ui/Preview";
import { confirmationEmail, loadInbox, type InboxRow } from "@/lib/email/service";
import { formatMoney } from "@/lib/format";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";
import { InboxButtons, SampleEmails } from "./InboxActions";

export const INBOX_HREF = "/invoices/inbox";
// How many emails the Invoices tab shows; the rest are on /invoices/inbox
const PREVIEW = 3;

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
const WAITING = new Set<InboxRow["status"]>(["to_confirm", "needs_review"]);

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// "2026-10-25" + "19:00" -> "Oct 25, 7:00 PM"
function pickup(date: string, time: string) {
  if (!date && !time) return "";
  const d = date ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";
  const t = time ? new Date(`2000-01-01T${time}:00Z`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : "";
  return [d, t].filter(Boolean).join(", ");
}

// One line about what's in it: the order, or what happened to it
function summary(e: InboxRow) {
  const o = e.customer_order;
  if (o && o.lines.length) {
    const dishes = o.lines.map((l) => `${l.qty} x ${l.name.replace(/\s*\(.*\)$/, "")}`).join(", ");
    const p = pickup(o.pickup_date, o.pickup_time);
    return `${dishes} · ${formatMoney(o.total)}${p ? ` · pickup ${p}` : ""}`;
  }
  return e.note ?? e.subject ?? "";
}

function StatusChip({ e }: { e: InboxRow }) {
  return (
    <>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS[e.status].className}`}>{STATUS[e.status].label}</span>
      {e.customer_order?.duplicate_of && WAITING.has(e.status) && (
        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">Possible repeat</span>
      )}
    </>
  );
}

// ---------- The full inbox (/invoices/inbox) ----------

function FullRow({ e, restaurant }: { e: InboxRow; restaurant: string }) {
  const o = e.customer_order;
  const actions: ("read" | "confirm" | "decline")[] =
    e.status === "to_confirm" ? ["confirm", "decline"] : e.status === "needs_review" && e.kind === "supplier_invoice" ? ["read", "decline"] : e.status === "needs_review" ? ["decline"] : [];
  return (
    <li id={`email-${e.id}`} className="scroll-mt-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <StatusChip e={e} />
        <span className="font-medium text-gray-900">{KIND[e.kind]}</span>
        <span className="text-gray-600">from {e.from_name || e.from_email}</span>
        {e.subject && <span className="text-gray-500">· {e.subject}</span>}
        <span className="ml-auto text-xs text-gray-400">{when(e.created_at)}</span>
      </div>
      {e.note && <p className="mt-1 text-sm text-gray-600">{e.note}</p>}
      {o?.duplicate_of && WAITING.has(e.status) && (
        <p className="mt-1 text-sm text-amber-800">
          The same order from the same person came in earlier (<a href={`#email-${o.duplicate_of}`} className="underline">see it</a>). Decline this one if it&apos;s a repeat.
        </p>
      )}
      {o && o.lines.length > 0 && (
        <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <ul className="grid gap-0.5">
            {o.lines.map((l) => (
              <li key={l.menu_item_id} className="flex justify-between gap-3"><span>{l.qty} x {l.name}</span><span className="tabular-nums">{formatMoney(l.qty * l.unit_price)}</span></li>
            ))}
          </ul>
          <p className="mt-1 flex justify-between border-t border-gray-200 pt-1 font-medium"><span>Total</span><span className="tabular-nums">{formatMoney(o.total)}</span></p>
          {pickup(o.pickup_date, o.pickup_time) && <p className="mt-1 text-gray-600">Pickup: {pickup(o.pickup_date, o.pickup_time)}</p>}
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

async function loadData(limit: number) {
  const db = await getSupabase();
  const [rows, r] = await Promise.all([loadInbox(db, limit), db.from("restaurants").select("name").eq("id", RESTAURANT_ID).maybeSingle()]);
  return { rows, restaurant: (r.data as { name: string } | null)?.name ?? "our restaurant" };
}

function Intro() {
  const address = process.env.INBOUND_EMAIL_ADDRESS;
  return (
    <>
      Supplier invoices are read and added on their own. Customer orders, and invoices from addresses that aren&apos;t your suppliers&apos;, wait for you.
      {address ? <> Suppliers and customers email <span className="font-medium text-gray-900">{address}</span>.</> : null}
    </>
  );
}

export async function FullInbox() {
  let data;
  try {
    data = await loadData(100);
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  const waiting = data.rows.filter((e) => WAITING.has(e.status));
  return (
    <section className="rounded-2xl border border-brand-100 bg-white p-5">
      <p className="mb-3 text-sm text-gray-600"><Intro /></p>
      <SampleEmails />
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No emails yet.</p>
      ) : (
        <>
          {/* Waiting for the owner first, then everything else, newest first */}
          <ul className="mt-3 divide-y divide-gray-100">
            {[...waiting, ...data.rows.filter((e) => !WAITING.has(e.status))].map((e) => <FullRow key={e.id} e={e} restaurant={data.restaurant} />)}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------- The preview on the Invoices tab ----------

export default async function EmailInboxPreview() {
  let data;
  try {
    data = await loadData(50);
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  const waiting = data.rows.filter((e) => WAITING.has(e.status));
  const top = [...waiting, ...data.rows.filter((e) => !WAITING.has(e.status))].slice(0, PREVIEW);
  return (
    <PreviewSection
      id="inbox"
      title="Email inbox"
      description={waiting.length ? `${waiting.length} waiting for you` : <Intro />}
      href={INBOX_HREF}
      total={data.rows.length}
      shown={top.length}
      action={<Link href={INBOX_HREF} className="text-sm font-medium text-brand-700 hover:underline">Open inbox</Link>}
    >
      {top.length === 0 ? (
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className="mb-3 text-sm text-gray-500">No emails yet.</p>
          <SampleEmails />
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-brand-100 bg-white">
          {top.map((e) => (
            <li key={e.id}>
              <Link href={`${INBOX_HREF}#email-${e.id}`} className="flex items-center gap-2 px-4 py-3 text-sm hover:bg-gray-50">
                <StatusChip e={e} />
                <span className="shrink-0 font-medium text-gray-900">{e.from_name || e.from_email}</span>
                <span className="min-w-0 flex-1 truncate text-gray-600">{summary(e)}</span>
                <span className="hidden shrink-0 text-xs text-gray-400 sm:inline">{when(e.created_at)}</span>
                <span className="shrink-0 text-gray-400" aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PreviewSection>
  );
}
