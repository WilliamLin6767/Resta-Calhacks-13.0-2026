"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CALLS_CHANGED } from "@/components/calls/CallRequests";

// Supplier calls waiting for approval, per section (see /api/calls/counts). Refreshed on every
// page change and whenever a calls panel changes something.
export function useCallCounts(): Record<string, number> {
  const pathname = usePathname();
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/calls/counts")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && d?.sections && setCounts(d.sections))
        .catch(() => {});
    load();
    window.addEventListener(CALLS_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CALLS_CHANGED, load);
    };
  }, [pathname]);
  return counts;
}
