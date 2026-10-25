"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useSyncExternalStore } from "react";
import NavIcon from "@/components/NavIcon";
import { useCallCounts } from "@/components/useCallCounts";
import { NAV, PROFILE, type Section } from "@/lib/nav";

// Collapsed or not lives on <html data-nav> (styled in globals.css, set before the first paint by
// app/layout.tsx), and is remembered on this browser.
export const NAV_KEY = "resta-nav";
const NAV_EVENT = "resta-nav-change";

function isCollapsed() {
  return document.documentElement.dataset.nav === "collapsed";
}

function setCollapsed(collapsed: boolean) {
  if (collapsed) document.documentElement.dataset.nav = "collapsed";
  else delete document.documentElement.dataset.nav;
  try {
    localStorage.setItem(NAV_KEY, collapsed ? "collapsed" : "open");
  } catch {
    // Storage blocked: it still collapses, just isn't remembered.
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(NAV_EVENT, onChange);
  return () => window.removeEventListener(NAV_EVENT, onChange);
}

function useCollapsed() {
  return useSyncExternalStore(subscribe, isCollapsed, () => false);
}

// Only after the first paint may the menu animate, so a remembered collapse doesn't slide on load.
function useNavReady() {
  useEffect(() => {
    const frame = requestAnimationFrame(() => document.documentElement.classList.add("nav-ready"));
    return () => cancelAnimationFrame(frame);
  }, []);
}

// "Collapse menu" / "Keep menu open", under the logo at the top of the desktop menu. After
// collapsing, the menu holds shut until the pointer leaves (data-hold on the .rail), or the hover
// would reopen it at once.
function CollapseButton() {
  const collapsed = useCollapsed();
  useNavReady();
  return (
    <button
      type="button"
      aria-pressed={collapsed}
      title={collapsed ? "Keep menu open" : "Collapse menu"}
      onClick={(e) => {
        const next = !isCollapsed();
        setCollapsed(next);
        const rail = e.currentTarget.closest<HTMLElement>(".rail");
        if (next && rail) {
          rail.dataset.hold = "";
          rail.addEventListener("pointerleave", () => delete rail.dataset.hold, { once: true });
        }
      }}
      className="ml-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <svg className="rail-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 17l-5-5 5-5" />
        <path d="M18 17l-5-5 5-5" />
      </svg>
      <span className="rail-label-close sr-only">Collapse menu</span>
      <span className="rail-label-open sr-only">Keep menu open</span>
    </button>
  );
}

// A thin bar in the section's color while that link's page is loading.
function PendingBar({ color }: { color: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span className="pointer-events-none fixed inset-x-0 top-0 z-50 hidden h-[3px] overflow-hidden md:block" role="progressbar" aria-label="Loading page">
      <span className={`nav-progress block h-full w-1/3 rounded-full ${color}`} />
    </span>
  );
}

// The section list. Phones show it inside AppShell's drawer. Desktop keeps it on the left, and
// `collapsible` adds the button that shrinks it to its icons. `phone` is the phone menu: Profile sits
// at its top next to Close (AppShell), where Safari's floating toolbar can't cover it, and the list
// gets room at the bottom so its last item can scroll above the toolbar.
// `restaurant` is the restaurant name. The layout loads it on the server and passes it in.
export default function Sidebar({ restaurant, collapsible = false, phone = false }: { restaurant: React.ReactNode; collapsible?: boolean; phone?: boolean }) {
  const pathname = usePathname();
  const callCounts = useCallCounts();
  const navId = useId();

  const item = (link: Section) => {
    const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href + "/"));
    const calls = link.calls ? (callCounts[link.calls] ?? 0) : 0;
    return (
      <Link
        href={link.href}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-10 items-center gap-2.5 rounded-xl px-1.5 text-[15px] leading-snug font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
          active ? "text-gray-900" : "text-gray-500"
        }`}
      >
        <PendingBar color={link.solid} />
        <span className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? `${link.solid} text-white` : link.soft}`}>
          <NavIcon icon={link.icon} size={18} />
          {/* Collapsed, the count can't show: a dot on the icon says there's something to approve */}
          {calls > 0 && <span aria-hidden className="rail-dot absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />}
        </span>
        <span className="rail-fade min-w-0 flex-1 whitespace-nowrap">{link.label}</span>
        {calls > 0 && (
          <span className="rail-fade flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
            {calls}
            <span className="sr-only"> supplier call{calls === 1 ? "" : "s"} to approve</span>
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className={`flex h-full flex-col border-r border-gray-200 bg-white px-4 py-4 text-gray-900 ${collapsible ? "rail-nav absolute inset-y-0 left-0 overflow-x-hidden" : "w-72"}`}
    >
      {/* The logo (the word shows only while the menu is fully open), and on desktop the collapse
          button below it, in line with the section icons */}
      <div className="mb-3 flex flex-col items-start gap-2">
        <Link
          href="/"
          aria-current={pathname === "/" ? "page" : undefined}
          className="flex w-fit items-center rounded-xl border border-gray-200 bg-[#fff] px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600"
        >
          <img src="/resta-mark.png" alt="" className="h-8 w-8 object-contain" />
          <span className="rail-word block overflow-hidden pl-2">
            <img src="/resta-word.png" alt="Resta" className="h-[18px] w-auto max-w-none" />
          </span>
        </Link>
        {collapsible && <CollapseButton />}
      </div>
      <p className="rail-fade mb-3 truncate px-1 text-sm whitespace-nowrap text-gray-500">{restaurant}</p>
      <div className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto ${phone ? "pb-[calc(5rem+env(safe-area-inset-bottom))]" : ""}`}>
        {NAV.map((group) => {
          const headingId = group.label ? `${navId}-${group.label.toLowerCase().replace(/\s+/g, "-")}` : undefined;
          return (
            <div key={group.label ?? "top"} className={group.label ? "rail-group mt-4" : undefined}>
              {group.label && (
                <p id={headingId} className="rail-heading mb-1 px-1.5 text-[11px] font-semibold tracking-wide whitespace-nowrap text-gray-400 uppercase">
                  {group.label}
                </p>
              )}
              <ul aria-labelledby={headingId} className="space-y-0.5">
                {group.sections.map((link) => (
                  <li key={link.href}>{item(link)}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {!phone && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          {item(PROFILE)}
        </div>
      )}
    </nav>
  );
}
