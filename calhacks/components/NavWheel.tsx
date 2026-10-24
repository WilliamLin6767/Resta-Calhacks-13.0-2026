"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import NavIcon from "@/components/NavIcon";
import { useCallCounts } from "@/components/useCallCounts";
import { SECTIONS, sectionFor } from "@/lib/nav";

// The desktop menu: half an oval on the left edge of the screen, like a wheel cut down the
// middle. Only a sliver shows until the mouse (or keyboard focus) reaches it; then it pops out.
// Scrolling over it turns the wheel: the sections travel around the oval one step at a time,
// and the one that stops at the pointer opens. Clicking a section opens it straight away.
// Phones use the drawer instead.

const WIDTH = 300; // the half oval: how far it reaches into the screen...
const HALF_HEIGHT = 290; // ...and half its height
const PATH_X = 70; // the oval path the sections travel on (inside the edge, leaving room for labels)
const PATH_Y = 210;
const STEP = 24; // degrees between sections on that path
const DOTS_INSET = 14; // the turning dots on the rim, this far inside the edge
const SLIVER = 20; // px of the oval left showing while it's tucked away
const OPEN_DELAY = 450; // ms the wheel must rest before the section under the pointer opens
const SCROLL_STEP = 50; // wheel delta (px) per section; trackpads add up small deltas
const SCROLL_COOLDOWN = 90; // ms between steps, so a trackpad flick doesn't fly past everything

// Rim dots every half step, enough of them to cover every turn of the wheel.
const DOTS = Array.from({ length: Math.ceil(((SECTIONS.length - 1) * STEP + 180) / (STEP / 2)) + 1 }, (_, k) => k * (STEP / 2) - 90);

export default function NavWheel() {
  const pathname = usePathname();
  const router = useRouter();
  const callCounts = useCallCounts();
  const current = Math.max(0, SECTIONS.findIndex((s) => s === sectionFor(pathname)));
  const [loading, startLoading] = useTransition();
  const [target, setTarget] = useState(current); // the section being loaded, for the progress bar's color

  // Where the wheel has been turned to. Tied to the page it was turned on, so after
  // navigating it rests on the new page's section again.
  const [turned, setTurned] = useState<{ path: string; index: number } | null>(null);
  const focus = turned?.path === pathname ? turned.index : current;
  const [open, setOpen] = useState(false);

  const navRef = useRef<HTMLElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest values, for the native wheel listener and timers.
  const live = useRef({ focus, current, pathname });
  useEffect(() => {
    live.current = { focus, current, pathname };
  });

  const go = (index: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (index === live.current.current) return;
    setTarget(index);
    startLoading(() => router.push(SECTIONS[index].href));
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
    const wheel = wheelRef.current;
    if (!wheel) return;
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
    wheel.addEventListener("wheel", onWheel, { passive: false });
    return () => wheel.removeEventListener("wheel", onWheel);
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

  const hasCalls = Object.values(callCounts).some((n) => n > 0);
  const turn = focus * STEP; // how far the wheel has turned, in degrees

  return (
    <>
      {/* While a page loads, a thin bar in its color runs along the top of the screen. */}
      {loading && (
        <div className="fixed inset-x-0 top-0 z-50 hidden h-[3px] overflow-hidden md:block" role="progressbar" aria-label="Loading page">
          <div className={`nav-progress h-full w-1/3 rounded-full ${SECTIONS[target].solid}`} />
        </div>
      )}

      <nav
        ref={navRef}
        aria-label="Main (scroll or use the arrow keys to turn, Enter to open)"
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!navRef.current?.contains(e.relatedTarget as Node | null)) close();
        }}
        className="fixed top-1/2 left-0 z-40 hidden md:block"
      >
        {/* The half oval. Everything inside is placed relative to the middle of its flat edge. */}
        <div
          ref={wheelRef}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={close}
          style={{
            width: WIDTH,
            height: HALF_HEIGHT * 2,
            top: -HALF_HEIGHT,
            borderRadius: `0 ${WIDTH}px ${WIDTH}px 0 / 0 ${HALF_HEIGHT}px ${HALF_HEIGHT}px 0`,
            translate: open ? "0 0" : `${-(WIDTH - SLIVER)}px 0`,
          }}
          className={`wheel-move absolute left-0 bg-gray-900 text-white ring-1 ring-white/10 ${open ? "shadow-2xl shadow-black/60" : ""}`}
        >
          {/* Tucked away: a bar in the current section's color marks the edge to hover,
              with a red dot when supplier calls are waiting. */}
          <span
            aria-hidden="true"
            className={`absolute h-12 w-1.5 -translate-y-1/2 rounded-full transition-opacity duration-200 ${SECTIONS[current].solid} ${open ? "opacity-0" : "opacity-100"}`}
            style={{ left: WIDTH - SLIVER / 2 - 3, top: HALF_HEIGHT }}
          />
          {hasCalls && (
            <span
              aria-hidden="true"
              className={`absolute h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-gray-900 transition-opacity duration-200 ${open ? "opacity-0" : "opacity-100"}`}
              style={{ left: WIDTH - SLIVER / 2 - 5, top: HALF_HEIGHT - 40 }}
            />
          )}

          <div className={`absolute left-0 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} style={{ top: HALF_HEIGHT }}>
            {/* Dots around the rim turn with the wheel, so a step reads as a turn. */}
            {DOTS.map((at) => {
              const angle = at - turn;
              return (
                <span
                  key={at}
                  aria-hidden="true"
                  className="wheel-orbit absolute -mt-[2px] -ml-[2px] h-1 w-1 rounded-full bg-white"
                  style={
                    {
                      "--wheel-a": `${angle}deg`,
                      "--rx": `${WIDTH - DOTS_INSET}px`,
                      "--ry": `${HALF_HEIGHT - DOTS_INSET}px`,
                      opacity: Math.abs(angle) < 85 ? 0.25 : 0,
                    } as React.CSSProperties
                  }
                />
              );
            })}

            {/* The pointer: whatever section stops here opens. It pulses a little at each step.
                The arrows beside it, by the flat edge, say the wheel scrolls. */}
            <span
              key={focus}
              aria-hidden="true"
              className="wheel-tick absolute h-12 w-[222px] -translate-y-1/2 rounded-full bg-white/10 ring-1 ring-white/15"
              style={{ left: PATH_X - 12 }}
            />
            <svg
              aria-hidden="true"
              width="12"
              height="20"
              viewBox="0 0 12 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute -translate-y-1/2 text-white/40"
              style={{ left: 26 }}
            >
              <path d="M2 7l4-4 4 4 M2 13l4 4 4-4" />
            </svg>

            {SECTIONS.map((link, i) => {
              const d = i - focus;
              const far = Math.abs(d);
              const shown = far <= 3;
              const active = i === focus;
              const calls = link.calls ? (callCounts[link.calls] ?? 0) : 0;
              return (
                <div
                  key={link.href}
                  className="wheel-orbit absolute"
                  style={
                    {
                      "--wheel-a": `${d * STEP}deg`,
                      "--rx": `${PATH_X}px`,
                      "--ry": `${PATH_Y}px`,
                      opacity: shown ? [1, 0.7, 0.45, 0.25][far] : 0,
                    } as React.CSSProperties
                  }
                >
                  <Link
                    href={link.href}
                    tabIndex={shown ? 0 : -1}
                    aria-current={i === current ? "page" : undefined}
                    onFocus={() => turnTo(i)}
                    onClick={(e) => {
                      // Cmd/Ctrl/middle-click still open a new tab as usual.
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      go(i);
                    }}
                    className={`absolute flex origin-left -translate-y-1/2 items-center gap-2.5 whitespace-nowrap font-semibold transition-[scale,color] duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white ${
                      shown ? "" : "pointer-events-none"
                    } ${active ? "scale-100 text-base text-white" : "scale-90 text-sm text-white/60 hover:text-white"}`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-300 ${active ? `${link.solid} text-white` : link.soft}`}>
                      <NavIcon icon={link.icon} size={18} />
                    </span>
                    {link.label}
                    {calls > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
                        {calls}
                        <span className="sr-only"> supplier call{calls === 1 ? "" : "s"} to approve</span>
                      </span>
                    )}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
