"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "@/components/NavIcon";
import { useCallCounts } from "@/components/useCallCounts";
import { PROFILE, SECTIONS, type Section } from "@/lib/nav";

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

// The section list. Phones show it inside AppShell's drawer. Desktop keeps it open on the left.
// `restaurant` is the restaurant name. The layout loads it on the server and passes it in.
export default function Sidebar({ restaurant }: { restaurant: React.ReactNode }) {
  const pathname = usePathname();
  const callCounts = useCallCounts();

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
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? `${link.solid} text-white` : link.soft}`}>
          <NavIcon icon={link.icon} size={18} />
        </span>
        <span className="min-w-0 flex-1 whitespace-nowrap">{link.label}</span>
        {calls > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
            {calls}
            <span className="sr-only"> supplier call{calls === 1 ? "" : "s"} to approve</span>
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav aria-label="Main" className="flex h-full w-72 flex-col border-r border-gray-200 bg-white px-4 py-4 text-gray-900">
      <Link
        href="/"
        aria-current={pathname === "/" ? "page" : undefined}
        className="mb-3 flex w-fit items-center gap-2 rounded-xl border border-gray-200 bg-[#fff] px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600"
      >
        <img src="/resta-mark.png" alt="" className="h-8 w-8 object-contain" />
        <img src="/resta-word.png" alt="Resta" className="h-[18px] w-auto" />
      </Link>
      <p className="mb-3 truncate px-1 text-sm text-gray-500">{restaurant}</p>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {SECTIONS.map((link) => (
          <li key={link.href}>{item(link)}</li>
        ))}
      </ul>
      <div className="mt-3 border-t border-gray-200 pt-3">
        {item(PROFILE)}
      </div>
    </nav>
  );
}
