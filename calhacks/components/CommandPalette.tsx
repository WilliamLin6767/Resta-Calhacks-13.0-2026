"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import NavIcon from "@/components/NavIcon";
import { MODULES } from "@/lib/analyticsSections";
import { PROFILE, SECTIONS } from "@/lib/nav";

// Extra words that find a section, besides its name.
const KEYWORDS: Record<string, string[]> = {
  "/": ["home", "dashboard", "today", "needs"],
  "/chat": ["talk", "voice", "restock", "message"],
  "/actions": ["approve", "approval", "proposal", "log", "case", "run now"],
  "/inventory": ["stock", "count", "waste", "delivery", "shelf", "receipt"],
  "/prep": ["forecast", "prep list", "tomorrow", "kitchen"],
  "/invoices": ["bill", "receipt", "order", "purchase", "scan", "po"],
  "/suppliers": ["vendor", "call", "price jump", "market"],
  "/menu": ["price", "dish", "margin", "pricing"],
  "/accounting": ["money", "bank", "cash", "savings", "payout", "quickbooks"],
  "/analytics": ["report", "numbers", "kpi", "charts"],
  "/trends": ["trend", "social"],
  "/marketing": ["instagram", "post", "agency", "caption", "buffer"],
  "/profile": ["account", "theme", "dark", "light", "appearance", "settings"],
};

// Opening the palette from anywhere else (e.g. the "Search" button in the page panel).
export const OPEN_PALETTE = "open-command-palette";

type Item =
  | { kind: "page"; id: string; label: string; hint?: string; href: string; icon: React.ReactNode; words: string[] }
  | { kind: "ask"; id: string; label: string; text: string };

const PAGES: Item[] = [
  ...SECTIONS.map((s) => ({
    kind: "page" as const,
    id: s.href,
    label: s.label,
    href: s.href,
    // Each section's icon in its own color, like the menu wheel
    icon: (
      <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-white ${s.solid}`}>
        <NavIcon icon={s.icon} size={16} />
      </span>
    ),
    words: KEYWORDS[s.href] ?? [],
  })),
  {
    kind: "page" as const,
    id: PROFILE.href,
    label: PROFILE.label,
    href: PROFILE.href,
    icon: (
      <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-white ${PROFILE.solid}`}>
        <NavIcon icon={PROFILE.icon} size={16} />
      </span>
    ),
    words: KEYWORDS[PROFILE.href] ?? [],
  },
  ...MODULES.map((m) => ({
    kind: "page" as const,
    id: `/analytics/${m.id}`,
    label: m.title,
    hint: "Analytics",
    href: `/analytics/${m.id}`,
    icon: (
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-analytics-500/15 text-analytics-600">
        <NavIcon icon="chart" size={16} />
      </span>
    ),
    words: [m.question],
  })),
  {
    kind: "page" as const,
    id: "logout",
    label: "Log out",
    href: "/login",
    icon: (
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
        <NavIcon icon="home" size={16} />
      </span>
    ),
    words: ["sign out", "logout", "lock"],
  },
];

function matches(item: Item, query: string) {
  if (item.kind !== "page") return true;
  const q = query.toLowerCase();
  return [item.label, item.hint ?? "", ...item.words].some((w) => w.toLowerCase().includes(q));
}

// Ctrl+K / Cmd+K from anywhere: type to jump to a page, or ask the AI.
export default function CommandPalette() {
  const router = useRouter();
  const { setOpen: setAssistantOpen, send } = useAssistant();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const listId = useId();
  const titleId = useId();

  const trimmed = query.trim();
  const items: Item[] = [
    ...PAGES.filter((p) => !trimmed || matches(p, trimmed)),
    ...(trimmed ? [{ kind: "ask" as const, id: "ask", label: `Ask AI: ${trimmed}`, text: trimmed }] : []),
  ];
  const current = items[Math.min(active, items.length - 1)];

  const show = () => {
    returnTo.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    returnTo.current?.focus?.(); // back to where the owner was
  };

  // Ctrl+K / Cmd+K toggles it, even from inside a text box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) hide();
        else show();
      }
    };
    const onOpen = () => show();
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE, onOpen);
    };
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Warm up the page that's highlighted, so Enter feels instant.
  useEffect(() => {
    if (open && current?.kind === "page") router.prefetch(current.href);
  }, [open, current, router]);

  function run(item: Item | undefined) {
    if (!item) return;
    hide();
    if (item.id === "logout") {
      // Clear the session cookie, then go to the login page.
      fetch("/api/logout", { method: "POST" }).finally(() => router.replace("/login"));
    } else if (item.kind === "page") {
      router.push(item.href);
    } else {
      setAssistantOpen(true);
      send(item.text);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-gray-950/40 px-4 pt-[12vh]" onMouseDown={hide}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className="palette-in w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <h2 id={titleId} className="sr-only">
          Go to a page or ask the AI
        </h2>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % Math.max(items.length, 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + items.length) % Math.max(items.length, 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(current);
            } else if (e.key === "Escape") {
              e.preventDefault();
              hide();
            }
          }}
          placeholder="Go to a page, or ask the AI..."
          className="w-full border-b border-gray-200 px-4 py-3.5 text-base outline-none placeholder:text-gray-400 focus-visible:outline-none"
        />
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
          {items.map((item) => {
            const selected = item === current;
            return (
              <li
                key={item.id}
                id={`${listId}-${item.id}`}
                role="option"
                aria-selected={selected}
                onMouseMove={() => setActive(items.indexOf(item))}
                onClick={() => run(item)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${selected ? "bg-gray-100 text-gray-900" : "text-gray-700"}`}
              >
                {item.kind === "page" ? (
                  item.icon
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900 text-xs text-white" aria-hidden="true">
                    ✦
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.kind === "page" && item.hint && <span className="text-xs text-gray-400">{item.hint}</span>}
              </li>
            );
          })}
          {items.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">Type something to ask the AI.</li>}
        </ul>
      </div>
    </div>
  );
}

// The small "Search Ctrl K" button at the top of the desktop page panel. The key label is picked
// after mount (the server can't know the platform), so the first paint says "Ctrl".
export function SearchButton() {
  const [mod, setMod] = useState("Ctrl");
  const { open: assistantOpen } = useAssistant();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setMod("⌘");
  }, []);
  // The assistant panel covers this corner (its × sits here), so step aside while it's open.
  if (assistantOpen) return null;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))}
      className="absolute top-4 right-6 hidden items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs text-gray-500 hover:border-gray-300 hover:text-gray-800 md:flex"
    >
      Search
      <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 font-sans text-[11px] text-gray-500">{mod} K</kbd>
    </button>
  );
}
