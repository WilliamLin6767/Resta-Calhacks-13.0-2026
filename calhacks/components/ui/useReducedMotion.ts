"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// Reads the setting right now. For lazy initial state that must be right on the first client
// render (e.g. useAnimateOnce); everything else should use the hook below.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(QUERY).matches;
}

// True when the user asked for less motion. Starts true (on the server and the first client
// render, so nothing moves before we know), then follows the real setting, live.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
