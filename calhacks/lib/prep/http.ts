import { addDays, todayLocal } from "./service";

// A prep day must be YYYY-MM-DD, from tomorrow to a week ahead. Returns null otherwise.
export function parsePrepDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const today = todayLocal();
  return value > today && value <= addDays(today, 7) ? value : null;
}
