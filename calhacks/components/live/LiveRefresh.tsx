"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import type { Topic } from "@/convex/topics";
import { createRefreshGate, type RefreshGate } from "@/lib/live/refreshGate";
import { LIVE_RESTAURANT_ID, useLiveOn, useLiveQuery } from "./useLiveQuery";

// While the owner types in a field, a refresh waits for them to leave it.
function isTyping() {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return true;
  return el instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset", "file", "range", "color"].includes(el.type);
}

// <LiveRefresh topics={["inventory", "attention"]} />: reloads the page's server data when another
// screen changes one of these topics (lib/live/refreshGate.ts for when). Renders nothing, and
// does nothing with Convex off.
export default function LiveRefresh({ topics }: { topics: Topic[] }) {
  const router = useRouter();
  const live = useLiveOn();
  const versions = useLiveQuery(api.live.topicVersions, live ? { restaurantId: LIVE_RESTAURANT_ID, topics } : "skip");
  const gate = useRef<RefreshGate | null>(null);

  useEffect(() => {
    if (!live) return;
    const g = createRefreshGate({ refresh: () => router.refresh(), isHidden: () => document.hidden, isTyping });
    gate.current = g;
    const onVisible = () => !document.hidden && g.visible();
    // Focus may move straight to another field: check once it has landed
    const onFocusOut = () => window.setTimeout(() => g.blur(), 0);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      g.dispose();
      gate.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [live, router]);

  useEffect(() => {
    if (versions) gate.current?.versions(versions as Record<string, number>);
  }, [versions]);

  return null;
}
