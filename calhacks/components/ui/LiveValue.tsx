"use client";

import { useState } from "react";

// A number an action on the page can change. When it changes after the first render (e.g. after
// router.refresh()), it flashes a soft highlight for 600ms so the owner sees what moved.
// The flash is in globals.css (.value-changed); never on first render.
export default function LiveValue({ value, className = "" }: { value: string; className?: string }) {
  const [shown, setShown] = useState(value);
  const [changes, setChanges] = useState(0);
  // Adjusting state while rendering (React's pattern for "prop changed"): no effect, no extra paint.
  if (shown !== value) {
    setShown(value);
    setChanges((n) => n + 1);
  }
  return (
    // key restarts the flash on every change. The padding is cancelled by the negative margin, so
    // the highlight has room without moving the text.
    <span key={changes} className={`-mx-1 rounded px-1 ${changes > 0 ? "value-changed" : ""} ${className}`}>
      {value}
    </span>
  );
}
