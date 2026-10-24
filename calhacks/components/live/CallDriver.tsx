"use client";

import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { isFollowed } from "./followedCalls";
import { LIVE_RESTAURANT_ID, useLiveOn, useLiveQuery } from "./useLiveQuery";

const EVERY_MS = 4000;

// A running call only moves forward when something asks GET /api/calls/:id/status (that route
// checks Wajo, at most every 5 seconds per call, so several tabs are safe). A calls panel does
// that for its own calls; this keeps any other running call going while no panel on this page
// shows it, so every screen sees its progress. Only with Convex on; stops while the tab is hidden.
export default function CallDriver() {
  const live = useLiveOn();
  const active = useLiveQuery(api.live.callsFor, live ? { restaurantId: LIVE_RESTAURANT_ID, activeOnly: true } : "skip");
  const ids = (active ?? []).map((c) => c.callId).join(",");

  useEffect(() => {
    if (!ids) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      for (const id of ids.split(",").map(Number)) {
        if (!isFollowed(id)) fetch(`/api/calls/${id}/status`).catch(() => {});
      }
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [ids]);

  return null;
}
