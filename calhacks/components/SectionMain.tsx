"use client";

import { usePathname } from "next/navigation";
import { sectionFor } from "@/lib/nav";

// The rounded white page panel. It carries the current section's theme, so brand-* classes on
// the page (buttons, tabs, accents) and the wash at the top use that section's color.
export default function SectionMain({ children }: { children: React.ReactNode }) {
  const section = sectionFor(usePathname());
  return (
    <main
      data-section={section?.theme}
      className="section-main my-4 mr-4 min-w-0 flex-1 rounded-[30px] bg-white px-10 py-10"
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </main>
  );
}
