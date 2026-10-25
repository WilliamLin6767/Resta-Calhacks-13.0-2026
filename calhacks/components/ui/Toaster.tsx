"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { sectionFor } from "@/lib/nav";

// Short messages after an action: "Invoice marked paid", or what went wrong. Bottom left on
// desktop (the Ask AI button is bottom right), near the bottom on phones.

type Tone = "success" | "error" | "info";
export type ToastInput = { message: string; tone?: Tone; action?: { label: string; onClick: () => void } };
type Toast = ToastInput & { id: number; leaving: boolean };

const MAX = 3;
const SHOW_MS = 4000;
const EXIT_MS = 200; // matches --duration-exit; the toast is removed after its fade

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const MARK: Record<Tone, { icon: string; className: string }> = {
  success: { icon: "✓", className: "bg-brand-500 text-white" },
  error: { icon: "!", className: "bg-red-500 text-white" },
  info: { icon: "i", className: "bg-gray-600 text-white" },
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  const tone = toast.tone ?? "info";
  const [paused, setPaused] = useState(false);

  // Goes away after SHOW_MS; hovering or focusing it holds it open (the timer starts over after).
  useEffect(() => {
    if (paused || toast.leaving) return;
    const timer = setTimeout(() => onClose(toast.id), SHOW_MS);
    return () => clearTimeout(timer);
  }, [paused, toast.leaving, toast.id, onClose]);

  return (
    <li
      role={tone === "error" ? "alert" : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`${toast.leaving ? "toast-out" : "toast-in"} pointer-events-auto flex items-start gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-lg`}
    >
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${MARK[tone].className}`} aria-hidden="true">
        {MARK[tone].icon}
      </span>
      <p className="min-w-0 flex-1">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onClose(toast.id);
          }}
          className="shrink-0 font-semibold text-brand-200 underline-offset-2 hover:underline"
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" onClick={() => onClose(toast.id)} aria-label="Close message" className="-mr-1 shrink-0 rounded px-1 text-white/60 hover:text-white">
        ×
      </button>
    </li>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const pathname = usePathname();
  const section = sectionFor(pathname);
  // On phones the Chat page has its composer at the bottom, so toasts go above it.
  const phoneBottom = pathname === "/chat" ? "bottom-[calc(5rem+env(safe-area-inset-bottom))]" : "bottom-[calc(1rem+env(safe-area-inset-bottom))]";

  // Fades the toast out, then removes it.
  const close = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    // Newest at the bottom; past MAX the oldest goes straight away.
    setToasts((list) => [...list, { ...input, id, leaving: false }].slice(-MAX));
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* data-section gives the toasts the current page's color, like the page panel */}
      <ol
        aria-live="polite"
        data-section={section?.theme}
        className={`pointer-events-none fixed inset-x-4 ${phoneBottom} z-[60] flex flex-col gap-2 md:right-auto md:bottom-6 md:left-[19rem] md:w-96`}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={close} />
        ))}
      </ol>
    </ToastContext.Provider>
  );
}
