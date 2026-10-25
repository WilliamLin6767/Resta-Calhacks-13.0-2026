// The second check inside routes that write (server only). proxy.ts already refuses requests
// without the owner's session; this repeats it next to the write, so a matcher change can't
// silently open a route.
//
//   const denied = requireOwner(request);
//   if (denied) return denied;
import "server-only";
import { authConfig, isAllowed } from "@/lib/session";

export function requireOwner(request: Request): Response | null {
  const config = authConfig();
  if (config.mode === "broken") return Response.json({ error: config.error }, { status: 503 });
  if (isAllowed(request, config)) return null;
  return Response.json({ error: "Log in first." }, { status: 401 });
}
