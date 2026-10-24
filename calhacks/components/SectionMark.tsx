"use client";

import { usePathname } from "next/navigation";
import NavIcon from "@/components/NavIcon";
import { sectionFor } from "@/lib/nav";

// The current section's icon in its color, next to the page title (matches the sidebar tile).
export default function SectionMark() {
  const section = sectionFor(usePathname());
  if (!section) return null;
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white bg-brand-600 shadow-sm ring-2 ring-brand-100`} aria-hidden="true">
      <NavIcon icon={section.icon} size={20} />
    </span>
  );
}
