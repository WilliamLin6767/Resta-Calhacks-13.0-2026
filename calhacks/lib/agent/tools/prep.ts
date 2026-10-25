// Prep: the forecast for a day and what to prep (the Prep page), and the AI adjustment for a
// note about the day (the same as /api/prep/adjust: returned, never saved).
import { z } from "zod";
import { adjustForNote } from "@/lib/prep/ai";
import { prepNeeds, weekdayName } from "@/lib/prep/forecast";
import { parsePrepDate, prepAiLimit } from "@/lib/prep/http";
import { addDays, loadPrep, todayLocal } from "@/lib/prep/service";
import { capped, json, round2, defineTool } from "../types";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// "today", "tomorrow", "saturday" or YYYY-MM-DD -> YYYY-MM-DD (a weekday is the next one, up to a week ahead), or null.
export function dayToDate(day: string, today = todayLocal()): string | null {
  const d = day.trim().toLowerCase();
  if (!d || d === "today") return today;
  if (d === "tomorrow") return addDays(today, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const wanted = WEEKDAYS.findIndex((w) => d.startsWith(w.slice(0, 3)));
  if (wanted < 0) return null;
  for (let n = 1; n <= 7; n++) {
    const date = addDays(today, n);
    if (weekdayName(date).toLowerCase() === WEEKDAYS[wanted]) return date;
  }
  return null;
}

export const prepTools = [
  defineTool({
    name: "get_prep_plan",
    tier: "read",
    area: "prep",
    description: "The sales forecast per dish for a day and the ingredients that would run short. day: 'today', 'tomorrow', a weekday name, or YYYY-MM-DD.",
    input: z.object({ day: z.string() }),
    run: async ({ day }, ctx) => {
      const date = dayToDate(day);
      if (!date) return `Error: I don't know which day "${day}" is. Say today, tomorrow or a weekday.`;
      const prep = await loadPrep(ctx.db, date);
      const f = prep.forecast;
      if (f.closed) return json({ date, weekday: f.weekday, closed: true });
      const short = prepNeeds(f, prep.recipes, prep.stock).filter((n) => n.short > 0);
      return json({
        date,
        weekday: f.weekday,
        based_on: f.days_used,
        dishes: capped(f.dishes.map((d) => ({ id: d.id, name: d.name, expected: d.expected, low: d.low, high: d.high, confidence: d.confidence }))),
        running_short: capped(short.map((n) => ({ name: n.name, unit: n.unit, needed: round2(n.needed), on_hand: round2(n.on_hand), on_order: round2(n.on_order), short: round2(n.short), only_if_busy: n.tight }))),
      });
    },
  }),
  defineTool({
    name: "adjust_prep_for_day",
    tier: "read",
    area: "prep",
    description:
      "Ask the AI how a note about a coming day (weather, an event) changes the forecast per dish. Returns the factors; nothing is saved, " +
      "the same as on the Prep page. day: tomorrow up to a week ahead.",
    input: z.object({ day: z.string(), note: z.string().min(1).max(500) }),
    run: async ({ day, note }, ctx) => {
      const date = parsePrepDate(dayToDate(day));
      if (!date) return "Error: Pick a day in the next week.";
      const limited = prepAiLimit(ctx.identity);
      if (limited) return `Error: ${limited}`;
      const { forecast } = await loadPrep(ctx.db, date);
      if (forecast.closed) return "Error: The restaurant is closed that day.";
      const result = await adjustForNote(date, forecast.weekday, forecast.dishes, note.trim());
      const names = new Map(forecast.dishes.map((d) => [d.id, d.name]));
      return json({ date, saved: false, summary: result.summary, adjustments: result.adjustments.map((a) => ({ ...a, dish: names.get(a.menu_item_id) })) });
    },
  }),
];
