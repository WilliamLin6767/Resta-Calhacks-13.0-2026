"use client";

import { useEffect, useState } from "react";
import Reveal from "@/components/ui/Reveal";

// Set by ScanInvoice just before it opens the invoice it read.
export const JUST_SCANNED = "invoice-just-scanned";
// Set instead when the scan was an invoice already in the system: it opens the original
export const ALREADY_SCANNED = "invoice-already-scanned";

// "You scanned this one before": shown once, at the top of the original, after a repeat scan
export function AlreadyEntered({ invoiceId }: { invoiceId: number }) {
  const [show] = useState(() => {
    try {
      return typeof window !== "undefined" && sessionStorage.getItem(ALREADY_SCANNED) === String(invoiceId);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      if (show) sessionStorage.removeItem(ALREADY_SCANNED);
    } catch {
      // storage blocked: nothing to clear
    }
  }, [show]);
  if (!show) return null;
  return (
    <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      This invoice was already in the system, maybe from an email or an earlier scan, so nothing was added twice: no second bill, stock
      or prices. This is the original.
    </p>
  );
}
const SEEN = "invoices-seen"; // invoices already opened in this browser

// The invoice's line rows. When the page opens straight after a scan, they rise in one after
// another. Read on the first client render: the scan opens this page by client navigation, so
// there's no server HTML to mismatch; on a direct load the flag isn't set.
export default function ScannedLines({ invoiceId, children }: { invoiceId: number; children: React.ReactNode }) {
  const [fresh] = useState(() => {
    try {
      return typeof window !== "undefined" && sessionStorage.getItem(JUST_SCANNED) === String(invoiceId);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      if (fresh) sessionStorage.removeItem(JUST_SCANNED);
    } catch {
      // storage blocked: nothing to clear
    }
  }, [fresh]);
  return (
    <Reveal as="tbody" initial={fresh}>
      {children}
    </Reveal>
  );
}

// The invoice's problems. The first time this browser opens an invoice, each one gets a single
// 600ms highlight in its own color (--flash, set per severity), so they're noticed.
export function FirstViewFlash({ invoiceId, className, children }: { invoiceId: number; className?: string; children: React.ReactNode }) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    try {
      const seen: number[] = JSON.parse(localStorage.getItem(SEEN) ?? "[]");
      if (seen.includes(invoiceId)) return;
      localStorage.setItem(SEEN, JSON.stringify([...seen, invoiceId].slice(-200)));
      // After mount on purpose: the server can't know what this browser has seen.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFlash(true);
    } catch {
      // storage blocked: no highlight
    }
  }, [invoiceId]);
  return <section className={`${className ?? ""} ${flash ? "flash-once" : ""}`}>{children}</section>;
}
