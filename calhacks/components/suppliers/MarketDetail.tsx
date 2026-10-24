"use client";

import { useState, type ReactNode } from "react";

// On a phone the price table and market chart stay behind one control.
// On a desktop this wrapper disappears and the children keep their place.
export default function MarketDetail({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="order-4 flex flex-col gap-4 md:contents">
      <button type="button" onClick={() => setOpen((value) => !value)} className="min-h-11 text-left text-sm font-medium text-gray-900 underline md:hidden">
        {open ? "Hide market detail" : "More market detail"}
      </button>
      <div className={`${open ? "flex" : "hidden"} flex-col gap-4 md:contents`}>{children}</div>
    </div>
  );
}
