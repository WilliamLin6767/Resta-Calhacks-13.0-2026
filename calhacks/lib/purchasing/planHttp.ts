import { parsePrepDate } from "@/lib/prep/http";
import type { PlanRequest } from "./planService";

// { kind: "low" } or { kind: "prep", date, factors } from a request body, or null if it's not valid
export function parsePlanRequest(body: Record<string, unknown>): PlanRequest | null {
  if (body.kind === "low") return { kind: "low" };
  if (body.kind !== "prep") return null;
  const date = parsePrepDate(body.date);
  if (!date) return null;
  const factors: Record<number, number> = {};
  if (body.factors && typeof body.factors === "object") {
    for (const [id, f] of Object.entries(body.factors)) if (Number.isInteger(Number(id)) && typeof f === "number") factors[Number(id)] = f;
  }
  return { kind: "prep", date, factors };
}
