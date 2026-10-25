// The app's sections: sidebar links, their icons, and each section's color (deep, muted
// tones; each page is themed in its color). Class names are written out in full so Tailwind sees them.

// Simple line icons (24x24, drawn with the text color).
export const ICONS = {
  chat: "M4 5h16v11H9l-5 4z M8 9h8 M8 12h5",
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  box: "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
  clipboard: "M9 3h6v3H9z M8 4.5H5V21h14V4.5h-3 M8 11h8 M8 15h8 M8 19h5",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3",
  truck: "M2 6h11v10H2z M13 10h4l3 3v3h-7 M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  tag: "M3 12V3h9l9 9-9 9z M7 7.5a1 1 0 1 0 2 0 1 1 0 0 0-2 0z",
  dollar: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M15 9.5C15 8.1 13.7 7 12 7s-3 1-3 2.4c0 3 6 1.7 6 4.8C15 15.6 13.7 17 12 17s-3-1.2-3-2.6 M12 5.5v13",
  chart: "M3 20h18 M5 20V11 M11 20V5 M17 20v-7",
  trend: "M3 17l6-6 4 4 8-8 M15 7h6v6",
  megaphone: "M4 10v4h3l5 4V6L7 10z M16 9a4 4 0 0 1 0 6 M18.5 7a7 7 0 0 1 0 10",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  check: "M4 4h16v16H4z M8 12l3 3 5-6",
  spark: "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M6 6l2 2 M16 16l2 2 M18 6l-2 2 M8 16l-2 2",
};

export type Section = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  calls?: "inventory" | "invoices" | "suppliers"; // which pending supplier-call count shows (see /api/calls/counts)
  theme: string; // the section's palette in app/globals.css; its page uses it as brand-*
  solid: string; // tile when it's the current page (white icon on it)
  soft: string; // tile otherwise
};

export type NavGroup = {
  label?: string; // omitted for the bare links at the top (Overview, Intelligence, Chat, Actions)
  sections: Section[];
};

// Sidebar order. SECTIONS is this list flattened, so the command palette and sectionFor stay in sync.
export const NAV: NavGroup[] = [
  {
    sections: [
      { href: "/", label: "Overview", icon: "home", theme: "overview", solid: "bg-overview-500", soft: "bg-overview-100 text-overview-700" },
      { href: "/intelligence", label: "Intelligence", icon: "spark", theme: "intelligence", solid: "bg-intelligence-500", soft: "bg-intelligence-100 text-intelligence-700" },
      { href: "/chat", label: "Chat", icon: "chat", theme: "chat", solid: "bg-chat-500", soft: "bg-chat-100 text-chat-700" },
      { href: "/actions", label: "Actions", icon: "check", theme: "actions", solid: "bg-actions-500", soft: "bg-actions-100 text-actions-700" },
    ],
  },
  {
    label: "Kitchen",
    sections: [
      { href: "/inventory", label: "Inventory", icon: "box", calls: "inventory", theme: "inventory", solid: "bg-inventory-500", soft: "bg-inventory-100 text-inventory-700" },
      { href: "/prep", label: "Prep", icon: "clipboard", theme: "prep", solid: "bg-prep-500", soft: "bg-prep-100 text-prep-700" },
      { href: "/menu", label: "Menu and pricing", icon: "tag", theme: "menu", solid: "bg-menu-500", soft: "bg-menu-100 text-menu-700" },
    ],
  },
  {
    label: "Buying",
    sections: [
      { href: "/invoices", label: "Invoices and buying", icon: "receipt", calls: "invoices", theme: "invoices", solid: "bg-invoices-500", soft: "bg-invoices-100 text-invoices-700" },
      { href: "/suppliers", label: "Suppliers", icon: "truck", calls: "suppliers", theme: "suppliers", solid: "bg-suppliers-500", soft: "bg-suppliers-100 text-suppliers-700" },
    ],
  },
  {
    label: "Outreach",
    sections: [
      { href: "/trends", label: "Trends", icon: "trend", theme: "trends", solid: "bg-trends-500", soft: "bg-trends-100 text-trends-700" },
      { href: "/marketing", label: "Marketing", icon: "megaphone", theme: "marketing", solid: "bg-marketing-500", soft: "bg-marketing-100 text-marketing-700" },
    ],
  },
  {
    label: "The books",
    sections: [
      { href: "/accounting", label: "Accounting", icon: "dollar", theme: "accounting", solid: "bg-accounting-500", soft: "bg-accounting-100 text-accounting-700" },
      { href: "/analytics", label: "Analytics", icon: "chart", theme: "analytics", solid: "bg-analytics-500", soft: "bg-analytics-100 text-analytics-700" },
    ],
  },
];

export const SECTIONS: Section[] = NAV.flatMap((group) => group.sections);

// Pinned under the section list. Same shape so the sidebar and the command palette can share it.
export const PROFILE: Section = {
  href: "/profile",
  label: "Profile",
  icon: "user",
  theme: "overview",
  solid: "bg-overview-500",
  soft: "bg-overview-100 text-overview-700",
};

// The section a path belongs to: "/invoices/12" -> Invoices and buying.
export function sectionFor(pathname: string): Section | undefined {
  return [...SECTIONS, PROFILE].find((s) => (s.href === "/" ? pathname === "/" : pathname === s.href || pathname.startsWith(s.href + "/")));
}
