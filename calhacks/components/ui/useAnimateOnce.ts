"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./useReducedMotion";

// Longest recharts default draw (Line and Pie: 1500ms), plus a little.
const FIRST_DRAW_MS = 1600;

// For a chart's isAnimationActive: true only while the chart draws for the first time, and only
// when motion is allowed. After that it's false, so a router.refresh() updates the chart in place
// instead of replaying the draw. (recharts treats an explicit true as "always animate", even with
// reduced motion, so the check has to happen here.)
export function useAnimateOnce(): boolean {
  const [active, setActive] = useState(() => !prefersReducedMotion());
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(false), FIRST_DRAW_MS);
    return () => clearTimeout(timer);
  }, [active]);
  return active;
}
