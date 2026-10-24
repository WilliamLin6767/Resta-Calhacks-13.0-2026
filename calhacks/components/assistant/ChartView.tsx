"use client";

import { useEffect, useRef } from "react";
import type { ExplainTarget } from "@/lib/assistant";
import { targetKey, useAssistant } from "./AssistantProvider";

const THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];
const HOVER_MS = 1000;

// Wraps a chart and tells the assistant how much of it is on screen, so questions like
// "what does this mean?" go to the right chart. Clicking or tapping inside it, or hovering
// for a second with a mouse, makes it the focus.
export default function ChartView({
  target,
  title,
  children,
}: {
  target: ExplainTarget;
  title: string;
  children: React.ReactNode;
}) {
  const { reportVisibility, unregister, pin } = useAssistant();
  const ref = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = targetKey(target);
  // Kept in a ref so the observer isn't recreated when the parent passes a new object.
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // A chart taller than the screen can't be 100% visible, so also count how much
        // of the screen it fills.
        const screenHeight = entry.rootBounds?.height || window.innerHeight;
        const ratio = Math.max(entry.intersectionRatio, entry.intersectionRect.height / screenHeight);
        reportVisibility(key, targetRef.current, title, Math.min(1, ratio));
      },
      { threshold: THRESHOLDS },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      unregister(key);
    };
  }, [key, title, reportVisibility, unregister]);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  return (
    <div
      ref={ref}
      onPointerDown={() => pin(key)}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return; // hover only counts on pointer devices
        hoverTimer.current = setTimeout(() => pin(key), HOVER_MS);
      }}
      onPointerLeave={() => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }}
    >
      {children}
    </div>
  );
}
