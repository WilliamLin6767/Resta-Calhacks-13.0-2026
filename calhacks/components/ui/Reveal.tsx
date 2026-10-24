"use client";

import { Children, cloneElement, isValidElement, useState } from "react";

const GAP_MS = 30;
const MAX_STAGGERED = 10; // after this many, the rest come in together

type Props = {
  as?: "ul" | "ol" | "div" | "tbody";
  className?: string;
  // Also animate what's there on the first render (e.g. an invoice opened right after a scan).
  initial?: boolean;
  children: React.ReactNode;
};

// A list whose new items rise in one after another, e.g. lines the AI just read from a photo.
// Items already on screen never move. Children need keys, and must be elements that take a
// className (li, tr, div...). The motion is CSS (.reveal-in), so reduced motion just shows them.
export default function Reveal({ as: Tag = "div", className, initial = false, children }: Props) {
  const items = Children.toArray(children);
  const keys = items.map((child) => (isValidElement(child) ? String(child.key) : ""));
  // Keys seen so far, and for each one that arrived later, its delay.
  const [seen, setSeen] = useState(() => ({ known: new Set(initial ? [] : keys), delays: new Map<string, number>() }));

  const arrived = keys.filter((k) => k && !seen.known.has(k));
  if (arrived.length > 0) {
    const known = new Set(seen.known);
    const delays = new Map(seen.delays);
    arrived.forEach((k, i) => {
      known.add(k);
      delays.set(k, Math.min(i, MAX_STAGGERED) * GAP_MS);
    });
    setSeen({ known, delays });
  }

  return (
    <Tag className={className}>
      {items.map((child) => {
        if (!isValidElement<{ className?: string; style?: React.CSSProperties }>(child)) return child;
        const delay = seen.delays.get(String(child.key));
        if (delay === undefined) return child;
        return cloneElement(child, {
          className: `${child.props.className ?? ""} reveal-in`,
          style: { ...child.props.style, animationDelay: `${delay}ms` },
        });
      })}
    </Tag>
  );
}
