"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { OPEN_PALETTE } from "@/components/CommandPalette";
import CallDriver from "@/components/live/CallDriver";
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

// Phone: top bar, a drawer menu, and a bottom bar.
// Desktop: the section list on the left, which can be collapsed to its icons. The logo at its top opens Overview.
export default function AppShell({ restaurant, children }: { restaurant: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  // The page the menu was opened on: going to another page closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);

  // The login page stands alone: no menu, and nothing that loads data before the owner logs in.
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 text-gray-900 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-11 w-11 items-center justify-center rounded-md border border-gray-300 text-gray-900"
        >
          <span aria-hidden className="flex flex-col gap-1">
            <span className="block h-0.5 w-4 bg-current" />
            <span className="block h-0.5 w-4 bg-current" />
            <span className="block h-0.5 w-4 bg-current" />
          </span>
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Back of House</p>
          <p className="truncate text-xs text-gray-500">{restaurant}</p>
        </div>
        {/* Phones have no Ctrl+K: this opens the command palette */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))}
          aria-label="Search"
          className="ml-auto flex h-11 w-11 items-center justify-center rounded-md border border-gray-300"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </button>
      </header>

      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Phone menu only. h-dvh is the visible screen, and the bottom padding (the home indicator's
          safe area plus a little) keeps Profile just above Safari's floating toolbar. */}
      <div className={`${open ? "fixed top-0 left-0 z-50 flex h-dvh" : "hidden"} md:hidden`}>
        <div className="flex h-full flex-col bg-white pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl">
          <div className="flex justify-end border-b border-gray-200">
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-4 text-sm font-medium text-gray-600">
              Close
            </button>
          </div>
          <Sidebar restaurant={restaurant} />
        </div>
      </div>

      {/* .rail: the menu's width, which collapses to its icons (globals.css) */}
      <aside className="rail sticky top-0 z-30 hidden h-dvh shrink-0 md:block">
        <Sidebar restaurant={restaurant} collapsible />
      </aside>
      {/* Keeps running supplier calls moving when no calls panel on this page shows them (Convex only) */}
      <CallDriver />

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
