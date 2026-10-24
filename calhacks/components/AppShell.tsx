"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import NavWheel from "@/components/NavWheel";
import SectionMain from "@/components/SectionMain";
import Sidebar from "@/components/Sidebar";

const phoneLinks = [
  { href: "/", label: "Overview" },
  { href: "/chat", label: "Chat" },
  { href: "/invoices", label: "Invoices" },
  { href: "/suppliers", label: "Suppliers" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
}

// Phone: top bar, full-screen menu, and a bottom bar.
// Desktop: the menu wheel at the left edge (NavWheel), with no top or bottom bar.
export default function AppShell({ restaurant, children }: { restaurant: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  // The page the menu was opened on: going to another page closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-gray-950 px-4 py-2 text-white md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-11 w-11 items-center justify-center rounded-md border border-white/15"
        >
          <span aria-hidden className="flex flex-col gap-1">
            <span className="block h-0.5 w-4 bg-white" />
            <span className="block h-0.5 w-4 bg-white" />
            <span className="block h-0.5 w-4 bg-white" />
          </span>
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Back of House</p>
          <p className="truncate text-xs text-white/60">{restaurant}</p>
        </div>
      </header>

      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className={`${open ? "fixed inset-y-0 left-0 z-50 flex" : "hidden"} md:hidden`}>
        <div className="flex h-full flex-col bg-gray-950 shadow-xl">
          <div className="flex justify-end border-b border-white/10">
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-4 text-sm font-medium text-white/70">
              Close
            </button>
          </div>
          <Sidebar restaurant={restaurant} />
        </div>
      </div>

      <NavWheel />

      <SectionMain>{children}</SectionMain>

      <nav aria-label="Owner actions" className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-4">
          {phoneLinks.map((link) => {
            const on = isActive(pathname, link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`flex min-h-14 items-center justify-center px-2 text-center text-sm ${on ? "font-semibold text-gray-900" : "text-gray-500"}`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
