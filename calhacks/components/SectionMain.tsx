"use client";

import { usePathname } from "next/navigation";
import { SearchButton } from "@/components/CommandPalette";
import { sectionFor } from "@/lib/nav";

// The rounded white page panel (on phones, a sheet above AppShell's bottom bar). It carries the current section's theme, so brand-* classes on
// the page (buttons, tabs, accents) and the wash at the top use that section's color.
export default function SectionMain({ children }: { children: React.ReactNode }) {
  const section = sectionFor(usePathname());
  return (
    <main
      data-section={section?.theme}
      className="section-main relative min-w-0 flex-1 rounded-t-[20px] bg-white px-4 py-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:m-1 md:rounded-[14px] md:px-6 md:py-5"
    >
      <SearchButton />
      <div className="mx-auto max-w-6xl">{children}</div>
    </main>
  );
}
