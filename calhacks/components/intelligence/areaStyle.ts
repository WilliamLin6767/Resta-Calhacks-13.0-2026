import type { AreaId } from "@/lib/intelligence/types";

// Each department in its own section's color (lib/nav.ts), written out in full so Tailwind sees them.
export const AREA_STYLE: Record<AreaId, { chip: string; dot: string; stroke: string }> = {
  sales: { chip: "bg-trends-50 text-trends-700 ring-trends-200", dot: "bg-trends-500", stroke: "var(--color-trends-500)" },
  inventory: { chip: "bg-inventory-50 text-inventory-700 ring-inventory-200", dot: "bg-inventory-500", stroke: "var(--color-inventory-500)" },
  purchasing: { chip: "bg-invoices-50 text-invoices-700 ring-invoices-200", dot: "bg-invoices-500", stroke: "var(--color-invoices-500)" },
  finance: { chip: "bg-accounting-50 text-accounting-700 ring-accounting-200", dot: "bg-accounting-500", stroke: "var(--color-accounting-500)" },
  marketing: { chip: "bg-marketing-50 text-marketing-700 ring-marketing-200", dot: "bg-marketing-500", stroke: "var(--color-marketing-500)" },
  menu: { chip: "bg-menu-50 text-menu-700 ring-menu-200", dot: "bg-menu-500", stroke: "var(--color-menu-500)" },
  analytics: { chip: "bg-analytics-50 text-analytics-700 ring-analytics-200", dot: "bg-analytics-500", stroke: "var(--color-analytics-500)" },
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

// "Ask Resta" opens the one chat with the question; the chat sends it once (app/chat/page.tsx).
export const askHref = (question: string) => `/chat?ask=${encodeURIComponent(question)}`;
