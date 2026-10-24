"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "@/components/NavIcon";
import { useCallCounts } from "@/components/useCallCounts";
import { SECTIONS } from "@/lib/nav";

// The phone menu, inside AppShell's drawer: every section as a plain list. Desktop uses NavWheel.
// `restaurant` is the restaurant name. The layout loads it on the server and passes it in.
export default function Sidebar({ restaurant }: { restaurant: React.ReactNode }) {
  // The current URL path, e.g. "/inventory". Used to highlight the active link.
  const pathname = usePathname();
  const callCounts = useCallCounts();

  return (
    <nav aria-label="Main" className="h-full w-64 overflow-y-auto bg-gray-950 px-[22px] py-8 text-white">
      <div className="mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-white text-sm font-bold text-gray-950">BH</div>
        <p className="mt-5 text-2xl leading-tight font-semibold">Back of House</p>
        <p className="mt-1 truncate text-sm text-white/60">{restaurant}</p>
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
                className={`flex min-h-11 items-center gap-3 text-[17px] leading-snug font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white ${
                  active ? "text-white" : "text-white/50"
                }`}
              >
                {/* The section's color: a solid tile for the current page, a soft one otherwise. */}
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? `${link.solid} text-white` : link.soft}`}>
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
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
