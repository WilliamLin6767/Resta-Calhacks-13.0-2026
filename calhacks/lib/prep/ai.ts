// The one job Claude does for prep planning (server only): turn the owner's note about the day
// ("Cal home game Saturday", "rain all day") into a per-dish adjustment of the forecast.
// Claude only suggests a factor and a reason; the math stays in forecast.ts, clamped to 0.5x-2x.
import { z } from "zod";
import { ask } from "@/lib/purchasing/ai";

const AdjustSchema = z.object({
  summary: z.string(), // one sentence for the owner
  adjustments: z.array(
    z.object({
      menu_item_id: z.number().int(),
      factor: z.number(), // 1.2 = 20% more than usual
      reason: z.string(),
    }),
  ),
});
export type Adjustment = z.infer<typeof AdjustSchema>;

const SYSTEM =
  "You help a small Vietnamese restaurant in Berkeley plan prep. You get tomorrow's sales forecast per dish (from the same weekday in recent weeks) and a note from the owner about the day. " +
  "Return a factor per dish the note actually affects (1.0 = no change, 1.2 = 20% more, 0.8 = 20% less), between 0.5 and 2.0. " +
  "Be conservative: only adjust when the note gives a real reason, and leave other dishes out. If the note doesn't change demand, return no adjustments. " +
  "Hot soups sell more on cold or rainy days; delivery orders rise in bad weather; nearby events bring crowds before or after, not during. " +
  "summary: one short sentence on what you changed and why. reason: a few words per dish.";

export async function adjustForNote(
  date: string,
  weekday: string,
  dishes: { id: number; name: string; expected: number }[],
  note: string,
): Promise<Adjustment> {
  const content = `Day: ${weekday} ${date}\nOwner's note: ${note}\nForecast:\n${dishes.map((d) => `- id ${d.id}: ${d.name}, about ${d.expected}`).join("\n")}`;
  const result = await ask(SYSTEM, content, AdjustSchema, "low");
  const ids = new Set(dishes.map((d) => d.id));
  return { summary: result.summary, adjustments: result.adjustments.filter((a) => ids.has(a.menu_item_id)) };
}
