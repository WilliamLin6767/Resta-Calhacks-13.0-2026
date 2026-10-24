"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/inventory", label: "Inventory" },
  { href: "/prep", label: "Prep" },
  { href: "/invoices", label: "Invoices and buying" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/menu", label: "Menu and pricing" },
  { href: "/accounting", label: "Accounting" },
  { href: "/analytics", label: "Analytics" },
  { href: "/trends", label: "Trends" },
];

// `restaurant` is the restaurant name. The layout loads it on the server and passes it in.
export default function Sidebar({ restaurant }: { restaurant: React.ReactNode }) {
  // The current URL path, e.g. "/inventory". Used to highlight the active link.
  const pathname = usePathname();

  return (
    <nav className="w-60 shrink-0 border-r border-gray-200/80 bg-white px-3 py-5">
      <div className="mb-6 flex items-center gap-3 px-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-sm font-bold text-white">
          BH
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Back of House</p>
          <p className="truncate text-xs text-gray-500">{restaurant}</p>
        </div>
      </div>
      <ul className="space-y-0.5">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active
                    ? "bg-gray-100 font-medium text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
