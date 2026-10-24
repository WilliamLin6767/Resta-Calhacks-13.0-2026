"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import NavIcon from "@/components/NavIcon";
import { useCallCounts } from "@/components/useCallCounts";
import { SECTIONS, sectionFor } from "@/lib/nav";

// The desktop menu: a dark wheel whose hub sits just off the left edge of the screen. Only a
// sliver shows until the mouse (or keyboard focus) reaches it; then it pops out. Scrolling
// over it turns the wheel one section per step, and the section that stops at the pointer
// (3 o'clock) opens. Clicking a section opens it straight away. Phones use the drawer instead.

const DISC = 380; // wheel radius, px
const HUB_X = -60; // where the wheel's center sits, relative to the screen's left edge
const RING = 180; // radius the sections sit on
const STEP = 20; // degrees between sections
const SLIVER = 28; // px of wheel left showing while it's tucked away
const OPEN_DELAY = 450; // ms the wheel must rest before the section under the pointer opens
const SCROLL_STEP = 50; // wheel delta (px) per section; trackpads add up small deltas
const SCROLL_COOLDOWN = 90; // ms between steps, so a trackpad flick doesn't fly past everything

export default function NavWheel({ restaurant }: { restaurant: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const callCounts = useCallCounts();
  const current = Math.max(0, SECTIONS.findIndex((s) => s === sectionFor(pathname)));

  // Where the wheel has been turned to. Tied to the page it was turned on, so after
  // navigating it rests on the new page's section again.
  const [turned, setTurned] = useState<{ path: string; index: number } | null>(null);
  const focus = turned?.path === pathname ? turned.index : current;
  const [open, setOpen] = useState(false);

  const navRef = useRef<HTMLElement>(null);
  const discRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest values, for the native wheel listener and timers.
  const live = useRef({ focus, current, pathname });
  useEffect(() => {
    live.current = { focus, current, pathname };
  });

  const go = (index: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (index !== live.current.current) router.push(SECTIONS[index].href);
  };

  const turnTo = (index: number) => {
    const next = Math.min(SECTIONS.length - 1, Math.max(0, index));
    if (next === live.current.focus) return;
    live.current.focus = next;
    setTurned({ path: live.current.pathname, index: next });
    router.prefetch(SECTIONS[next].href);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(next), OPEN_DELAY);
  };

  // Scrolling over the wheel turns it instead of scrolling the page. React's onWheel is
  // passive (it can't stop the page scrolling), so this listens natively.
  const turnRef = useRef(turnTo);
  useEffect(() => {
    turnRef.current = turnTo;
  });
  useEffect(() => {
    const disc = discRef.current;
    if (!disc) return;
    let sum = 0;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY; // lines -> px
      sum += delta;
      const now = performance.now();
      if (Math.abs(sum) < SCROLL_STEP || now - last < SCROLL_COOLDOWN) return;
      turnRef.current(live.current.focus + Math.sign(sum));
      sum = 0;
      last = now;
    };
    disc.addEventListener("wheel", onWheel, { passive: false });
    return () => disc.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Leaving with the wheel turned opens that section now rather than after the delay.
  const close = () => {
    setOpen(false);
    if (timer.current) go(live.current.focus);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      turnTo(focus + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Escape") {
      (document.activeElement as HTMLElement | null)?.blur();
      setOpen(false);
    }
  };

  const tucked = -(HUB_X + DISC - SLIVER); // shift that leaves only the sliver on screen
  const section = SECTIONS[focus];

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      onKeyDown={onKeyDown}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!navRef.current?.contains(e.relatedTarget as Node | null)) close();
      }}
      className="fixed top-1/2 left-0 z-40 hidden md:block"
    >
      <div
        ref={discRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={close}
        style={{
          width: DISC * 2,
          height: DISC * 2,
          left: HUB_X - DISC,
          top: -DISC,
          translate: open ? "0 0" : `${tucked}px 0`,
        }}
        className={`absolute rounded-full bg-gray-900 text-white ring-1 ring-white/10 transition-[translate,box-shadow] duration-300 ease-out motion-reduce:transition-none ${
          open ? "shadow-2xl shadow-black/60" : ""
        }`}
      >
        {/* Tucked away: a bar in the current section's color marks the edge to hover. */}
        <span
          aria-hidden="true"
          className={`absolute top-1/2 h-14 w-1.5 -translate-y-1/2 rounded-full transition-opacity duration-200 ${SECTIONS[current].solid} ${open ? "opacity-0" : "opacity-100"}`}
          style={{ left: DISC * 2 - SLIVER / 2 - 3 }}
        />
        {Object.values(callCounts).some((n) => n > 0) && (
          <span
            aria-hidden="true"
            className={`absolute h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-gray-900 transition-opacity duration-200 ${open ? "opacity-0" : "opacity-100"}`}
            style={{ left: DISC * 2 - SLIVER / 2 - 5, top: DISC - 44 }}
          />
        )}

        {/* Everything below sits relative to the wheel's center. */}
        <div className={`absolute transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} style={{ left: DISC, top: DISC }}>
          {/* Who this is, at the top of the visible part of the wheel */}
          <div className="absolute flex items-center gap-3" style={{ left: -HUB_X + 24, top: -DISC + 130 }}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-white text-sm font-bold text-gray-950">BH</div>
            <div className="whitespace-nowrap">
              <p className="text-base leading-tight font-semibold">Back of House</p>
              <p className="text-xs text-white/60">{restaurant}</p>
            </div>
          </div>

          {/* The pointer: whatever section stops here opens. */}
          <span
            aria-hidden="true"
            className="absolute h-14 w-[205px] -translate-y-1/2 rounded-full bg-white/10 ring-1 ring-white/15"
            style={{ left: RING - 14 }}
          />

          {SECTIONS.map((link, i) => {
            const d = i - focus;
            const angle = d * STEP;
            const far = Math.abs(d);
            const shown = far <= 3;
            const active = i === focus;
            const calls = link.calls ? (callCounts[link.calls] ?? 0) : 0;
            return (
              <div
                key={link.href}
                className="absolute transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none"
                style={{
                  transform: `rotate(${angle}deg) translateX(${RING}px) rotate(${-angle}deg)`,
                  opacity: shown ? 1 - far * 0.25 : 0,
                }}
              >
                <Link
                  href={link.href}
                  tabIndex={shown ? 0 : -1}
                  aria-current={i === current ? "page" : undefined}
                  onFocus={() => turnTo(i)}
                  onClick={() => {
                    if (timer.current) clearTimeout(timer.current);
                    timer.current = null;
                  }}
                  className={`absolute flex origin-left -translate-y-1/2 items-center gap-3 whitespace-nowrap font-semibold transition-[scale,color] duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white ${
                    shown ? "" : "pointer-events-none"
                  } ${active ? "scale-100 text-[17px] text-white" : "scale-90 text-[15px] text-white/60 hover:text-white"}`}
                >
                  <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? `${link.solid} text-white` : link.soft}`}>
                    <NavIcon icon={link.icon} size={20} />
                  </span>
                  {link.label}
                  {calls > 0 && (
                    <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">
                      {calls}
                      <span className="sr-only"> supplier call{calls === 1 ? "" : "s"} to approve</span>
                    </span>
                  )}
                </Link>
              </div>
            );
          })}

          {/* How to use it, at the bottom of the visible part */}
          <p className="absolute text-xs whitespace-nowrap text-white/50" style={{ left: -HUB_X + 24, top: DISC - 150 }}>
            Scroll to turn · stops on <span className="text-white/80">{section.label}</span>
          </p>
        </div>
      </div>
    </nav>
  );
}
