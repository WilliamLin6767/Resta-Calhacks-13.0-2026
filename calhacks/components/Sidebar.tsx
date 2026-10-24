"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/inventory", label: "Inventory" },
  { href: "/invoices", label: "Invoices and buying" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/analytics", label: "Analytics" },
  { href: "/trends", label: "Trends" },
];

export default function Sidebar() {
  // The current URL path, e.g. "/inventory". Used to highlight the active link.
  const pathname = usePathname();

  return (
    <nav className="w-56 shrink-0 border-r border-gray-200 bg-white p-4">
      <p className="mb-6 px-3 text-lg font-bold">Back of House</p>
      <ul className="space-y-1">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`block rounded px-3 py-2 text-sm ${
                  active ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"
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
