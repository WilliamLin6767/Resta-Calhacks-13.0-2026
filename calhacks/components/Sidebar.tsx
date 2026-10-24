"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CALLS_CHANGED } from "@/components/calls/CallRequests";
import NavIcon from "@/components/NavIcon";
import { SECTIONS } from "@/lib/nav";

const COLLAPSED_KEY = "sidebar-collapsed"; // remembered per browser

// `restaurant` is the restaurant name. The layout loads it on the server and passes it in.
export default function Sidebar({ restaurant }: { restaurant: React.ReactNode }) {
  // The current URL path, e.g. "/inventory". Used to highlight the active link.
  const pathname = usePathname();
  // Supplier calls waiting for approval, per section. Refreshed on every page change
  // and whenever a calls panel changes something.
  const [callCounts, setCallCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/calls/counts")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && d?.sections && setCallCounts(d.sections))
        .catch(() => {});
    load();
    window.addEventListener(CALLS_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CALLS_CHANGED, load);
    };
  }, [pathname]);

  // Collapsed: a thin rail of icons. Hovering it (or tabbing into it) slides the full menu
  // open over the page; leaving closes it again. "Keep menu open" pins it back.
  const [collapsed, setCollapsed] = useState(false);
  const [peek, setPeek] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    try {
      // Read after mounting: the server can't see this browser's choice.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {
      // Storage blocked: start open.
    }
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    setPeek(false);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Not remembered, still works.
    }
  };
  const open = !collapsed || peek;

  return (
    // The outer box holds the space in the page: full width open, a thin rail collapsed.
    // While peeking, the menu is wider than its box and slides over the page.
    <div className={`relative shrink-0 transition-[width] duration-300 ease-out ${collapsed ? "w-[84px]" : "w-64"}`}>
      {/* Dark, like the Figma design: big white links, the current page bright and the rest faded. */}
      <nav
        ref={navRef}
        aria-label="Main"
        onMouseEnter={() => collapsed && setPeek(true)}
        onMouseLeave={() => setPeek(false)}
        onFocus={() => collapsed && setPeek(true)}
        onBlur={(e) => {
          if (!navRef.current?.contains(e.relatedTarget as Node | null)) setPeek(false);
        }}
        className={`absolute inset-y-0 left-0 z-40 overflow-x-clip bg-gray-950 text-white transition-[width,box-shadow] duration-300 ease-out ${
          open ? "w-64" : "w-[84px]"
        } ${collapsed && peek ? "shadow-2xl shadow-black/60" : ""}`}
      >
        {/* Always laid out at full width; a collapsed rail just clips everything right of the icons. */}
        <div className="sticky top-0 w-64 px-[22px] py-10">
          <div className="mb-10">
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-white text-sm font-bold text-gray-950">BH</div>
              <button
                type="button"
                onClick={toggle}
                aria-label={collapsed ? "Keep menu open" : "Collapse menu"}
                title={collapsed ? "Keep menu open" : "Collapse menu"}
                className={`mr-2 rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white ${open ? "" : "invisible"}`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={collapsed ? "M13 6l6 6-6 6 M5 6l6 6-6 6" : "M11 6l-6 6 6 6 M19 6l-6 6 6 6"} />
                </svg>
              </button>
            </div>
            <div className={`transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}>
              <p className="mt-5 text-2xl leading-tight font-semibold whitespace-nowrap">Back of House</p>
              <p className="mt-1 truncate text-sm text-white/60">{restaurant}</p>
            </div>
          </div>
          <ul className="space-y-1">
            {SECTIONS.map((link) => {
              const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href + "/"));
              const calls = link.calls ? (callCounts[link.calls] ?? 0) : 0;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex origin-left items-center gap-3 py-1.5 pl-0.5 text-[17px] leading-snug font-semibold whitespace-nowrap transition-[scale,color] duration-200 ease-out motion-safe:hover:scale-110 motion-safe:focus-visible:scale-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white ${
                      active ? "text-white" : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    {/* The section's color: a solid tile for the current page, a soft one otherwise. */}
                    <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${active ? `${link.solid} text-white` : link.soft}`}>
                      <NavIcon icon={link.icon} size={20} />
                      {/* On the rail the count can't show, so a dot marks calls to approve. */}
                      {calls > 0 && !open && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-gray-950" aria-hidden="true" />}
                    </span>
                    {/* Faded out on the rail, so no half-cut letters show at its edge. Screen readers still read it. */}
                    <span className={`flex items-center gap-3 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}>
                      {link.label}
                      {calls > 0 && (
                        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">
                          {calls}
                          <span className="sr-only"> supplier call{calls === 1 ? "" : "s"} to approve</span>
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </div>
  );
}
