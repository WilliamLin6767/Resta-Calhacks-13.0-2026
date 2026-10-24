import { AiError } from "./ai";

// Every error response has the same shape: { error: "..." }
export function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Turns anything thrown while handling a request into a readable error response.
export function handleError(err: unknown) {
  if (err instanceof AiError) return errorResponse(err.message, err.status);
  const message = err instanceof Error ? err.message : "Something went wrong.";
  console.error(err);
  return errorResponse(message, 500);
}

// "/api/invoices/12/check" -> 12, or null if the id isn't a positive whole number
export function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
