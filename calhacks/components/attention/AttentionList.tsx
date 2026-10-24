"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import OrderPlan from "@/components/OrderPlan";
import { TAB_LABELS, type Action, type Item } from "@/lib/attention/types";

const DOT = { act: "bg-red-500", watch: "bg-amber-400", info: "bg-gray-300" };
const mainClass = "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 sm:w-auto";
const linkClass = "text-sm text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50";

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

function Row({ item, showTab, onDismiss }: { item: Item; showTab: boolean; onDismiss: (i: Item) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const refresh = () => router.refresh();
  const primary = item.actions[0];
  const rest = item.actions.slice(1);
  return (
    <li className="py-3">
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
              {item.actions.map((action, i) => <ActionButton key={i} action={action} main={i === 0} onDone={refresh} />)}
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
            <ActionButton action={primary} main onDone={refresh} />
          </div>
        )}
        {open && (
          <div className="mt-3 space-y-2">
            {showTab && <Link href={TAB_LABELS[item.tab].href} className="text-sm text-gray-500 underline">{TAB_LABELS[item.tab].label}</Link>}
            {rest.map((action, i) => <ActionButton key={i} action={action} main={false} onDone={refresh} />)}
            {item.dismissable && (
              <button onClick={() => onDismiss(item)} className="min-h-11 text-sm text-gray-500 underline">
                Not now
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// Decisions first ("To do now"); everything else folded under "Keep an eye on".
// On a phone the row is the title, a short line, and the main button. Tap the title for the rest.
export default function AttentionList({ items, showTab = false, limit = 4 }: { items: Item[]; showTab?: boolean; limit?: number }) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = items.filter((i) => !hidden.has(i.key));
  const now = visible.filter((i) => i.level === "act");
  const later = visible.filter((i) => i.level !== "act");
  const shown = all ? now : now.slice(0, limit);

  async function dismiss(item: Item) {
    setHidden(new Set(hidden).add(item.key));
    await fetch("/api/attention/dismiss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key, fingerprint: item.fingerprint }) }).catch(() => null);
    router.refresh();
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{now.length ? `To do now (${now.length})` : "To do now"}</p>
      {now.length === 0 ? (
        <p className="py-3 text-sm text-gray-600">Nothing needs a decision right now.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {shown.map((item) => <Row key={item.key} item={item} showTab={showTab} onDismiss={dismiss} />)}
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
            {later.map((item) => <Row key={item.key} item={item} showTab={showTab} onDismiss={dismiss} />)}
          </ul>
        </details>
      )}
    </div>
  );
}
