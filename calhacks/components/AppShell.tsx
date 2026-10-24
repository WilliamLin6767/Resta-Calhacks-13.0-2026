"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import Sidebar from "@/components/Sidebar";

const phoneLinks = [
  { href: "/chat", label: "Chat" },
  { href: "/", label: "Overview" },
  { href: "/invoices", label: "Invoices" },
  { href: "/suppliers", label: "Suppliers" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
}

// Phone: top bar, full-screen menu, and a bottom bar. Chat is the first stop.
// Desktop: the same sidebar, with no top or bottom bar.
export default function AppShell({ restaurant, children }: { restaurant: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-11 w-11 items-center justify-center rounded-md border border-gray-200"
        >
          <span aria-hidden className="flex flex-col gap-1">
            <span className="block h-0.5 w-4 bg-gray-900" />
            <span className="block h-0.5 w-4 bg-gray-900" />
            <span className="block h-0.5 w-4 bg-gray-900" />
          </span>
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Back of House</p>
          <p className="truncate text-xs text-gray-500">{restaurant}</p>
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

      <div className={`${open ? "fixed inset-y-0 left-0 z-50 flex" : "hidden"} md:static md:flex md:shrink-0`}>
        <div className="flex h-full flex-col bg-white shadow-xl md:shadow-none">
          <div className="flex justify-end border-b border-gray-100 md:hidden">
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-4 text-sm font-medium text-gray-700">
              Close
            </button>
          </div>
          <Sidebar restaurant={restaurant} />
        </div>
      </div>

      <main className="min-w-0 flex-1 px-4 py-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-8 md:py-8 md:pb-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

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
