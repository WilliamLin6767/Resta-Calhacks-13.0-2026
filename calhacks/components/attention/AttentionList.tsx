"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import OrderPlan from "@/components/OrderPlan";
import { useReducedMotion } from "@/components/ui/useReducedMotion";
import { useToast } from "@/components/ui/Toaster";
import { TAB_LABELS, type Action, type Item } from "@/lib/attention/types";

const DOT = { act: "bg-red-500", watch: "bg-amber-400", info: "bg-gray-300" };
<<<<<<< HEAD
const mainClass = "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:w-auto";
const linkClass = "text-sm text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50";
// A "To do now" item on desktop is a kitchen ticket: a white slip with a dashed tear line on top.
const ticketClass = "md:rounded-xl md:border md:border-t-2 md:border-gray-200 md:border-t-brand-200 md:bg-white md:px-4 md:shadow-sm md:[border-top-style:dashed]";

// How long the stamp shows before the ticket leaves, and how long leaving takes (--duration-fast
// and --duration-exit). With reduced motion the stamp just shows, then the ticket goes.
const STAMP_MS = 150;
const OUT_MS = 200;
const STILL_MS = 300;

type Stamp = "Done" | "Hidden";
=======
const mainClass = "inline-flex min-h-10 items-center justify-center rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:min-h-8 sm:text-[13px]";
const linkClass = "text-sm text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50 sm:text-[13px]";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}>
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
>>>>>>> 7cb2944870462c1eb89bfbbc91b54ec70de3be8f

// One button. The item's first action is the main button; the rest are small links next to it.
function ActionButton({ action, main, onDone }: { action: Action; main: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const cls = main ? mainClass : linkClass;
  if (action.kind === "link") return <Link href={action.href} className={main ? `${mainClass} inline-block` : linkClass}>{action.label}</Link>;
  // Opens the owner's own Messages / phone / email app with the message filled in; they press send there
  if (action.kind === "open") return <a href={action.href} className={main ? `${mainClass} inline-block` : linkClass}>{action.label}</a>;
  if (action.kind === "plan") return <OrderPlan request={action.request} label={action.label} />;
  if (action.kind === "copy") {
    return (
      <button
        className={cls}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(action.text);
            setNote("Copied. Paste it into their support chat.");
          } catch {
            setNote("Couldn't copy.");
          }
        }}
      >
        {note || action.label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={busy}
        className={cls}
        onClick={async () => {
          setBusy(true);
          setNote("");
          try {
            const calls = action.kind === "posts" ? action.calls : [{ path: action.path, body: action.body }];
            for (const c of calls) {
              const res = await fetch(c.path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c.body ?? {}) });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
            }
            onDone();
          } catch (e) {
            setNote(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving..." : action.label}
      </button>
      {note && <span className="text-xs text-red-600">{note}</span>}
    </span>
  );
}

<<<<<<< HEAD
function Row({
  item,
  showTab,
  ticket,
  stamp,
  leaving,
  onDismiss,
  onDone,
}: {
  item: Item;
  showTab: boolean;
  ticket: boolean;
  stamp?: Stamp;
  leaving: boolean;
  onDismiss: (i: Item) => void;
  onDone: (i: Item, action: Action) => void;
}) {
  const [open, setOpen] = useState(false);
  const primary = item.actions[0];
  const rest = item.actions.slice(1);
  const done = (action: Action) => () => onDone(item, action);
  return (
    <li className={`relative py-3 ${ticket ? ticketClass : ""} ${leaving ? "ticket-out overflow-hidden" : ""}`}>
      {/* "Done" / "Hidden", stamped on the ticket before it leaves */}
      {stamp && (
        <span
          aria-hidden="true"
          className="ticket-stamp pointer-events-none absolute top-3 right-4 z-10 -rotate-[8deg] rounded-md border-2 border-brand-600 bg-white/85 px-2 py-0.5 text-sm font-bold tracking-widest text-brand-600 uppercase"
        >
          {stamp}
        </span>
      )}
      <div className="hidden gap-3 md:flex">
        <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${DOT[item.level]}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900">
            {item.title}
            {showTab && (
              <Link href={TAB_LABELS[item.tab].href} className="ml-2 whitespace-nowrap text-xs font-normal text-gray-500 hover:underline">
                {TAB_LABELS[item.tab].label} →
              </Link>
            )}
          </p>
          {item.detail && <p className="text-sm text-gray-600">{item.detail}</p>}
          {(item.actions.length > 0 || item.dismissable) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              {item.actions.map((action, i) => <ActionButton key={i} action={action} main={i === 0} onDone={done(action)} />)}
              {item.dismissable && (
                <button onClick={() => onDismiss(item)} className="text-sm text-gray-400 hover:text-gray-700" title="Hide this until something changes">
                  Not now
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="md:hidden">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="w-full text-left">
          <p className="font-medium text-gray-900">{item.title}</p>
          {item.detail && <p className="mt-0.5 line-clamp-2 text-sm font-normal text-gray-600">{item.detail}</p>}
        </button>
        {primary && (
          <div className="mt-2">
            <ActionButton action={primary} main onDone={done(primary)} />
          </div>
        )}
        {open && (
          <div className="mt-3 space-y-2">
            {showTab && <Link href={TAB_LABELS[item.tab].href} className="text-sm text-gray-500 underline">{TAB_LABELS[item.tab].label}</Link>}
            {rest.map((action, i) => <ActionButton key={i} action={action} main={false} onDone={done(action)} />)}
=======
// One line per item: the title. Click it for the detail and the buttons.
function Row({ item, showTab, onDismiss }: { item: Item; showTab: boolean; onDismiss: (i: Item) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const refresh = () => router.refresh();
  return (
    <li>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="no-lift flex w-full items-center gap-2.5 rounded-md px-1 py-2 text-left hover:bg-gray-50">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[item.level]}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm font-medium text-gray-900">
          {item.title}
          {showTab && <span className="ml-2 whitespace-nowrap text-xs font-normal text-gray-500">{TAB_LABELS[item.tab].label}</span>}
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="pb-3 pl-5 pr-1">
          {item.detail && <p className="text-sm text-gray-600">{item.detail}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            {item.actions.map((action, i) => <ActionButton key={i} action={action} main={i === 0} onDone={refresh} />)}
            {showTab && <Link href={TAB_LABELS[item.tab].href} className={linkClass}>Open {TAB_LABELS[item.tab].label}</Link>}
>>>>>>> 7cb2944870462c1eb89bfbbc91b54ec70de3be8f
            {item.dismissable && (
              <button onClick={() => onDismiss(item)} className="text-sm text-gray-400 hover:text-gray-700 sm:text-[13px]" title="Hide this until something changes">
                Not now
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

// Folded by default: one line with the counts. Open it for the list, decisions first.
export default function AttentionList({ items, showTab = false, limit = 4 }: { items: Item[]; showTab?: boolean; limit?: number }) {
  const router = useRouter();
<<<<<<< HEAD
  const toast = useToast();
  const reduced = useReducedMotion();
=======
  const [open, setOpen] = useState(false);
>>>>>>> 7cb2944870462c1eb89bfbbc91b54ec70de3be8f
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // Tickets on their way out: the stamp, then the slide. While any is leaving, the list is drawn
  // from the items as they were when the owner acted, so a quick refresh can't cut the slide short.
  const [stamps, setStamps] = useState<Record<string, Stamp>>({});
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [frozen, setFrozen] = useState<Item[] | null>(null);
  const pending = useRef(0);
  const visible = (frozen ?? items).filter((i) => !hidden.has(i.key));
  const now = visible.filter((i) => i.level === "act");
  const later = visible.filter((i) => i.level !== "act");
  const shown = all ? now : now.slice(0, limit);

  // Stamps the ticket, slides it out, then hides it. The work (server call, refresh) is already
  // under way; this is only the picture.
  function leave(item: Item, stamp: Stamp) {
    pending.current += 1;
    setFrozen((f) => f ?? items);
    setStamps((st) => ({ ...st, [item.key]: stamp }));
    const gone = () => {
      setHidden((h) => new Set(h).add(item.key));
      pending.current -= 1;
      if (pending.current === 0) setFrozen(null);
    };
    if (reduced) {
      setTimeout(gone, STILL_MS);
      return;
    }
    setTimeout(() => setLeaving((l) => new Set(l).add(item.key)), STAMP_MS);
    setTimeout(gone, STAMP_MS + OUT_MS);
  }

  async function dismiss(item: Item) {
    leave(item, "Hidden");
    await fetch("/api/attention/dismiss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key, fingerprint: item.fingerprint }) }).catch(() => null);
    router.refresh();
  }

<<<<<<< HEAD
  function done(item: Item, action: Action) {
    router.refresh();
    leave(item, "Done");
    toast({ message: `Done: ${action.label}`, tone: "success" });
  }

  const row = (item: Item, ticket: boolean) => (
    <Row
      key={item.key}
      item={item}
      showTab={showTab}
      ticket={ticket}
      stamp={stamps[item.key]}
      leaving={leaving.has(item.key)}
      onDismiss={dismiss}
      onDone={done}
    />
  );

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{now.length ? `To do now (${now.length})` : "To do now"}</p>
      {now.length === 0 ? (
        <p className="py-3 text-sm text-gray-600">Nothing needs a decision right now.</p>
      ) : (
        <ul className="divide-y divide-gray-100 md:mt-2 md:space-y-2 md:divide-y-0">
          {shown.map((item) => row(item, true))}
        </ul>
      )}
      {now.length > limit && (
        <button onClick={() => setAll(!all)} className="text-sm text-gray-600 hover:underline">
          {all ? "Show fewer" : `Show ${now.length - limit} more`}
        </button>
      )}
      {later.length > 0 && (
        <details className="mt-2 border-t border-gray-100 pt-2">
          <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">Keep an eye on ({later.length})</summary>
          <ul className="divide-y divide-gray-100">
            {later.map((item) => row(item, false))}
          </ul>
        </details>
=======
  if (visible.length === 0) return <p className="text-sm text-gray-600">Nothing needs a decision right now.</p>;
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="no-lift flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-left text-sm hover:bg-gray-50">
        {now.length > 0 ? (
          <span className="flex items-center gap-2 font-medium text-gray-900"><span className={`h-1.5 w-1.5 rounded-full ${DOT.act}`} aria-hidden="true" />{now.length} to do now</span>
        ) : (
          <span className="text-gray-600">Nothing to decide right now</span>
        )}
        {later.length > 0 && (
          <span className="flex items-center gap-2 text-gray-600"><span className={`h-1.5 w-1.5 rounded-full ${DOT.watch}`} aria-hidden="true" />{later.length} to keep an eye on</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-gray-500">{open ? "Hide" : "Show"} <Chevron open={open} /></span>
      </button>
      {open && (
        <div className="mt-2">
          {now.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {shown.map((item) => <Row key={item.key} item={item} showTab={showTab} onDismiss={dismiss} />)}
            </ul>
          )}
          {now.length > limit && (
            <button onClick={() => setAll(!all)} className="mt-1 px-1 text-sm text-gray-600 hover:underline">
              {all ? "Show fewer" : `Show ${now.length - limit} more`}
            </button>
          )}
          {later.length > 0 && (
            <>
              <p className="mt-3 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Keep an eye on</p>
              <ul className="divide-y divide-gray-100">
                {later.map((item) => <Row key={item.key} item={item} showTab={showTab} onDismiss={dismiss} />)}
              </ul>
            </>
          )}
        </div>
>>>>>>> 7cb2944870462c1eb89bfbbc91b54ec70de3be8f
      )}
    </div>
  );
}
