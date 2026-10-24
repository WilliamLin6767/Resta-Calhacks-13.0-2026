"use client";

import { useState, type ReactNode } from "react";

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}>
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Folded by default: one line saying what's inside (counts, mostly). Click it for the rest.
// Keeps long lists out of the owner's face until they want them.
export default function Fold({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="no-lift flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-left text-sm hover:bg-gray-50">
        {summary}
        <span className="ml-auto flex items-center gap-1 text-gray-500">{open ? "Hide" : "Show"} <Chevron open={open} /></span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
