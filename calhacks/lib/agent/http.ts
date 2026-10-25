// Rate limits for the agent's routes, shared so /api/agent and the chat, voice and panel
// wrappers count against the same limits (the same numbers those routes had before).
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import type { Surface } from "./types";

const MIN10 = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const LIMITS: Record<Exclude<Surface, "loop">, { perVisitor: ReturnType<typeof createRateLimiter>; wholeApp: ReturnType<typeof createRateLimiter>; busy: string; done: string }> = {
  chat: {
    perVisitor: createRateLimiter({ limit: 20, windowMs: MIN10 }),
    wholeApp: createRateLimiter({ limit: 300, windowMs: DAY }),
    busy: "You've sent a lot of messages in the last 10 minutes. Try again in a few minutes.",
    done: "Chat has reached today's limit. Try again tomorrow.",
  },
  voice: {
    perVisitor: createRateLimiter({ limit: 80, windowMs: MIN10 }),
    wholeApp: createRateLimiter({ limit: 500, windowMs: DAY }),
    busy: "You've used voice a lot in the last 10 minutes. Try again in a few minutes.",
    done: "Voice has reached today's limit. Try again tomorrow.",
  },
  panel: {
    perVisitor: createRateLimiter({ limit: 20, windowMs: MIN10 }),
    wholeApp: createRateLimiter({ limit: 300, windowMs: DAY }),
    busy: "You've asked a lot of questions in the last 10 minutes. Try again in a few minutes.",
    done: "The assistant has reached today's limit. Try again tomorrow.",
  },
};

// A 429 response when this visitor (or the whole app) is over the limit for the surface, else null.
export function agentLimit(request: Request, surface: Exclude<Surface, "loop">): Response | null {
  const l = LIMITS[surface];
  const visitor = l.perVisitor(clientIp(request));
  if (!visitor.ok) return Response.json({ error: l.busy }, { status: 429, headers: { "Retry-After": String(visitor.retryAfterSeconds) } });
  const app = l.wholeApp(surface);
  if (!app.ok) return Response.json({ error: l.done }, { status: 429, headers: { "Retry-After": String(app.retryAfterSeconds) } });
  return null;
}
