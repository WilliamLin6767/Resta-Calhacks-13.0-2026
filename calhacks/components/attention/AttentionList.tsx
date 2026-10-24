"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import OrderPlan from "@/components/OrderPlan";
import { TAB_LABELS, type Action, type Item } from "@/lib/attention/types";

const LEVEL = {
  act: { label: "Needs you", stripe: "border-l-red-500", tag: "bg-red-50 text-red-700" },
  watch: { label: "Watch", stripe: "border-l-amber-400", tag: "bg-amber-50 text-amber-800" },
  info: { label: "FYI", stripe: "border-l-gray-300", tag: "bg-gray-100 text-gray-600" },
};
const primaryClass = "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 sm:w-auto";
const buttonClass = "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50 sm:w-auto";

function primaryOf(actions: Action[]): Action | undefined {
  return actions.find((action) => action.kind === "post" && action.primary) ?? actions.find((action) => action.kind === "open") ?? actions[0];
}

function ActionButton({ action, onDone }: { action: Action; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  if (action.kind === "link") return <Link href={action.href} className={buttonClass}>{action.label}</Link>;
  // Opens the owner's own Messages / phone / email app with the message filled in
  if (action.kind === "open") return <a href={action.href} className={primaryClass}>{action.label}</a>;
  if (action.kind === "plan") return <OrderPlan request={action.request} label={action.label} />;
  if (action.kind === "copy") {
    return (
      <button
        className={buttonClass}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(action.text);
            setNote("Copied");
          } catch {
            setNote("Couldn't copy");
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
        className={action.primary ? primaryClass : buttonClass}
        onClick={async () => {
          setBusy(true);
          setNote("");
          try {
            const res = await fetch(action.path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action.body ?? {}) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
            onDone();
          } catch (e) {
            setNote(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "..." : action.label}
      </button>
      {note && <span className="text-xs text-red-600">{note}</span>}
    </span>
  );
}

function AttentionRow({ item, showTab, onDone, onDismiss }: { item: Item; showTab: boolean; onDone: () => void; onDismiss: (item: Item) => void }) {
  const [open, setOpen] = useState(false);
  const primary = primaryOf(item.actions);
  const rest = item.actions.filter((action) => action !== primary);
  return (
    <div className={`rounded-md border border-l-4 border-gray-200 bg-white px-3 py-2.5 ${LEVEL[item.level].stripe}`}>
      <div className="hidden flex-wrap items-start justify-between gap-x-4 gap-y-2 md:flex">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${LEVEL[item.level].tag}`}>{LEVEL[item.level].label}</span>
            {showTab && <Link href={TAB_LABELS[item.tab].href} className="mr-2 text-xs font-normal text-gray-500 underline">{TAB_LABELS[item.tab].label}</Link>}
            {item.title}
          </p>
          {item.detail && <p className="mt-0.5 text-sm text-gray-600">{item.detail}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.actions.map((action, i) => <ActionButton key={i} action={action} onDone={onDone} />)}
          {item.dismissable && (
            <button onClick={() => onDismiss(item)} className="text-xs text-gray-500 underline hover:text-gray-800" title="Hide until this changes">
              Dismiss
            </button>
          )}
        </div>
      </div>

      <div className="md:hidden">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="w-full text-left">
          <p className="text-sm font-medium">{item.title}</p>
          {item.detail && <p className="mt-0.5 line-clamp-2 text-sm font-normal text-gray-600">{item.detail}</p>}
        </button>
        {primary && (
          <div className="mt-2">
            <ActionButton action={primary} onDone={onDone} />
          </div>
        )}
        {open && (
          <div className="mt-3 space-y-2">
            {showTab && <Link href={TAB_LABELS[item.tab].href} className="text-sm text-gray-500 underline">{TAB_LABELS[item.tab].label}</Link>}
            {rest.map((action, i) => <ActionButton key={i} action={action} onDone={onDone} />)}
            {item.dismissable && (
              <button onClick={() => onDismiss(item)} className="min-h-11 text-sm text-gray-500 underline">
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// The to-do items with their buttons. `showTab` labels each item with its tab (for Overview).
// On a phone the row is the title and the main button. Tap the title for the detail and the other buttons.
export default function AttentionList({ items, showTab = false, limit = 5 }: { items: Item[]; showTab?: boolean; limit?: number }) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = items.filter((i) => !hidden.has(i.key));
  const shown = all ? visible : visible.slice(0, limit);

  function onDone() {
    router.refresh();
  }

  async function dismiss(item: Item) {
    setHidden(new Set(hidden).add(item.key));
    await fetch("/api/attention/dismiss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key, fingerprint: item.fingerprint }) }).catch(() => null);
    router.refresh();
  }

  if (!visible.length) return <p className="text-sm text-gray-500">Nothing needs you here right now.</p>;
  return (
    <div className="grid gap-2">
      {shown.map((item) => <AttentionRow key={item.key} item={item} showTab={showTab} onDone={onDone} onDismiss={dismiss} />)}
      {visible.length > limit && (
        <button onClick={() => setAll(!all)} className="justify-self-start text-sm text-gray-600 underline">
          {all ? "Show fewer" : `Show ${visible.length - limit} more`}
        </button>
      )}
    </div>
  );
}
