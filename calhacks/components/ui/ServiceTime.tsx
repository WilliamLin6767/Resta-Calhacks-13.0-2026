import { connection } from "next/server";

// Parts of the restaurant's day, in Berkeley time. A guess for a typical lunch-and-dinner place:
// change these per restaurant. Each entry starts at its time (minutes after midnight).
const ZONE = "America/Los_Angeles";
const PERIODS = [
  { from: 0, label: "Before lunch" },
  { from: 11 * 60, label: "Lunch service" },
  { from: 14 * 60 + 30, label: "Between services" },
  { from: 17 * 60, label: "Dinner service" },
  { from: 21 * 60 + 30, label: "After close" },
];

function nowInRestaurant() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;
  const period = [...PERIODS].reverse().find((p) => minutes >= p.from) ?? PERIODS[0];
  const date = now.toLocaleDateString("en-US", { timeZone: ZONE, weekday: "long", month: "short", day: "numeric" });
  return { period: period.label, date };
}

// "Lunch service · Saturday, Oct 24" above the Overview title. The time is read per request,
// inside Suspense, so the home page's instant shell stays static.
export default async function ServiceTime() {
  await connection();
  const now = nowInRestaurant();
  return (
    <p className="mb-3 flex h-6 items-center gap-2 text-sm text-gray-500">
      <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-100">{now.period}</span>
      <span>{now.date}</span>
    </p>
  );
}
