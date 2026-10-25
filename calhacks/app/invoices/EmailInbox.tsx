import Link from "next/link";
import ErrorMessage from "@/components/ErrorMessage";
import PreviewSection from "@/components/ui/Preview";
import { everydayOrderReply } from "@/lib/email/catering";
import { confirmationEmail, loadInbox, type InboxRow } from "@/lib/email/service";
import { formatMoney } from "@/lib/format";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";
import { CheckEmailNow, InboxButtons, SampleEmails, type InboxAction } from "./InboxActions";

// "Check email now" only when the Gmail script is deployed as a web app (integrations/gmail)
const canCheckNow = () => !!process.env.GMAIL_CHECK_URL;

export const INBOX_HREF = "/invoices/inbox";
// How many emails the Invoices tab shows; the rest are on /invoices/inbox
const PREVIEW = 3;

const STATUS: Record<InboxRow["status"], { label: string; className: string }> = {
  new: { label: "Reading", className: "bg-gray-100 text-gray-700" },
  done: { label: "Added", className: "bg-green-50 text-green-800" },
  needs_review: { label: "Check the sender", className: "bg-amber-50 text-amber-800" },
  to_confirm: { label: "To accept", className: "bg-red-50 text-red-700" },
  confirmed: { label: "Confirmed", className: "bg-green-50 text-green-800" },
  declined: { label: "Declined", className: "bg-gray-100 text-gray-600" },
  ignored: { label: "Skipped", className: "bg-gray-100 text-gray-600" },
  error: { label: "Couldn't read", className: "bg-red-50 text-red-700" },
};
const KIND = { supplier_invoice: "Supplier invoice", customer_order: "Catering request", other: "Other", unknown: "Email" };
// Catering only by email: an everyday order is skipped (lib/email/catering.ts)
const isEveryday = (e: InboxRow) => e.kind === "customer_order" && e.customer_order?.catering === false;
const kindOf = (e: InboxRow) => (isEveryday(e) ? "Everyday order" : KIND[e.kind]);

// An accepted customer order (held for pickup, not a sale yet)
const isAccepted = (e: InboxRow) => e.kind === "customer_order" && e.status === "confirmed" && !e.order_id;
// Still needs the owner: to accept or decline, check a sender, or say how an accepted order was paid
const needsOwner = (e: InboxRow) => e.status === "to_confirm" || e.status === "needs_review" || isAccepted(e);

function statusOf(e: InboxRow) {
  if (e.kind === "customer_order") {
    if (isAccepted(e)) return { label: "Accepted", className: "bg-blue-50 text-blue-800" };
    if (e.status === "done" || e.status === "confirmed") return { label: "Done", className: "bg-green-50 text-green-800" };
  }
  if (e.kind === "supplier_invoice" && e.status === "done" && e.note?.startsWith("Already in the system")) {
    return { label: "Already added", className: "bg-gray-100 text-gray-700" };
  }
  return STATUS[e.status];
}

function actionsOf(e: InboxRow): InboxAction[] {
  if (e.status === "to_confirm") return e.customer_order?.duplicate_of ? ["decline", "confirm"] : ["confirm", "decline"];
  if (isAccepted(e)) return ["picked-up", "register", "cancel"];
  if (e.status === "needs_review") return e.kind === "supplier_invoice" ? ["read", "decline"] : ["decline"];
  return [];
}

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
    if (isEveryday(e)) return "An everyday order, skipped: reply that they can order by phone or online";
    const dishes = o.lines.map((l) => `${l.qty} x ${l.name.replace(/\s*\(.*\)$/, "")}`).join(", ");
    const p = pickup(o.pickup_date, o.pickup_time);
    return `${o.headcount ? `For ${o.headcount} · ` : ""}${dishes} · ${formatMoney(o.total)}${p ? ` · ${o.delivery ? "deliver" : "pickup"} ${p}` : ""}`;
  }
  return e.note ?? e.subject ?? "";
}

function StatusChip({ e }: { e: InboxRow }) {
  return (
    <>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${statusOf(e).className}`}>{statusOf(e).label}</span>
      {e.customer_order?.duplicate_of && e.status === "to_confirm" && (
        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">Possible repeat</span>
      )}
    </>
  );
}

// ---------- The full inbox (/invoices/inbox) ----------

function FullRow({ e, restaurant }: { e: InboxRow; restaurant: string }) {
  const o = e.customer_order;
  const actions = actionsOf(e);
  return (
    <li id={`email-${e.id}`} className="scroll-mt-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <StatusChip e={e} />
        <span className="font-medium text-gray-900">{kindOf(e)}</span>
        <span className="text-gray-600">from {e.from_name || e.from_email}</span>
        {e.subject && <span className="text-gray-500">· {e.subject}</span>}
        <span className="ml-auto text-xs text-gray-400">{when(e.created_at)}</span>
      </div>
      {e.note && <p className="mt-1 text-sm text-gray-600">{e.note}</p>}
      {o?.duplicate_of && e.status === "to_confirm" && (
        <p className="mt-1 text-sm text-amber-800">
          The same order from the same person came in earlier (<a href={`#email-${o.duplicate_of}`} className="underline">see it</a>). Decline this one if it&apos;s a repeat.
        </p>
      )}
      {o && isEveryday(e) && (
        <a href={everydayOrderReply(o.customer_email, o.customer_name, restaurant)} className="mt-1 inline-block text-sm text-brand-700 underline">
          Reply: order by phone or online
        </a>
      )}
      {o && o.lines.length > 0 && !isEveryday(e) && (
        <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          {(o.headcount || o.delivery) && (
            <p className="mb-1 font-medium text-gray-700">
              {[o.headcount ? `For ${o.headcount} people` : "", o.delivery ? "Delivery requested" : ""].filter(Boolean).join(" · ")}
            </p>
          )}
          <ul className="grid gap-0.5">
            {o.lines.map((l) => (
              <li key={l.menu_item_id} className="flex justify-between gap-3"><span>{l.qty} x {l.name}</span><span className="tabular-nums">{formatMoney(l.qty * l.unit_price)}</span></li>
            ))}
          </ul>
          <p className="mt-1 flex justify-between border-t border-gray-200 pt-1 font-medium"><span>Total</span><span className="tabular-nums">{formatMoney(o.total)}</span></p>
          {pickup(o.pickup_date, o.pickup_time) && <p className="mt-1 text-gray-600">{o.delivery ? "Deliver" : "Pickup"}: {pickup(o.pickup_date, o.pickup_time)}</p>}
          {o.notes && <p className="text-gray-600">Note: {o.notes}</p>}
          {o.unmatched.length > 0 && <p className="text-amber-800">Not on the menu: {o.unmatched.join(", ")}</p>}
        </div>
      )}
      {e.invoice_id && <Link href={`/invoices/${e.invoice_id}`} className="mt-1 inline-block text-sm text-brand-700 underline">Open the invoice</Link>}
      {isAccepted(e) && (
        <p className="mt-2 text-sm text-gray-600">
          When it&apos;s paid for, pick one so it&apos;s counted once: <span className="font-medium">Picked up and paid</span> records the sale here.
          If you ring it up at the register or scan its receipt, choose <span className="font-medium">Rang up at the register</span>.
        </p>
      )}
      {actions.length > 0 && (
        <InboxButtons id={e.id} actions={actions} replyHref={isAccepted(e) && o && o.lines.length ? confirmationEmail(o, restaurant) : undefined} />
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
      Supplier invoices are read and added on their own. Catering requests (events, groups, 10 or more dishes) and invoices from addresses that
      aren&apos;t your suppliers&apos; wait for you. Everyday orders by email are skipped, with a reply pointing to phone or online ordering.
      {address ? <> Suppliers and catering customers email <span className="font-medium text-gray-900">{address}</span>.</> : null}
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
  return (
    <section className="rounded-2xl border border-brand-100 bg-white p-5">
      <p className="mb-3 text-sm text-gray-600"><Intro /></p>
      {canCheckNow() && <div className="mb-3"><CheckEmailNow /></div>}
      <SampleEmails />
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No emails yet.</p>
      ) : (
        // Waiting for the owner first, then everything else, newest first
        <ul className="mt-3 divide-y divide-gray-100">
          {[...data.rows.filter(needsOwner), ...data.rows.filter((e) => !needsOwner(e))].map((e) => <FullRow key={e.id} e={e} restaurant={data.restaurant} />)}
        </ul>
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
  const waiting = data.rows.filter(needsOwner);
  const top = [...waiting, ...data.rows.filter((e) => !needsOwner(e))].slice(0, PREVIEW);
  return (
    <PreviewSection
      id="inbox"
      title="Email inbox"
      description={waiting.length ? `${waiting.length} waiting for you` : <Intro />}
      href={INBOX_HREF}
      total={data.rows.length}
      shown={top.length}
      action={
        <>
          {canCheckNow() && <CheckEmailNow />}
          <Link href={INBOX_HREF} className="text-sm font-medium text-brand-700 hover:underline">Open inbox</Link>
        </>
      }
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
