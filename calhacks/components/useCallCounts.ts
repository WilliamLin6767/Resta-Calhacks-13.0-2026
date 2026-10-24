"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CALLS_CHANGED } from "@/components/calls/CallRequests";
import { LIVE_RESTAURANT_ID, useLiveOn, useLiveQuery } from "@/components/live/useLiveQuery";
import { api } from "@/convex/_generated/api";

// Supplier calls waiting for approval, per section (see /api/calls/counts). Refreshed on every
// page change and whenever a calls panel changes something. With Convex on they come from
// Convex instead, pushed as soon as any screen changes a call.
export function useCallCounts(): Record<string, number> {
  const pathname = usePathname();
  const live = useLiveOn();
  const liveCounts = useLiveQuery(api.live.counts, live ? { restaurantId: LIVE_RESTAURANT_ID } : "skip");
  // Convex on but never synced yet (null): fetch as before
  const fetching = !live || liveCounts === null;
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!fetching) return;
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
  }, [pathname, fetching]);
  return liveCounts ? liveCounts.sections : counts;
}
