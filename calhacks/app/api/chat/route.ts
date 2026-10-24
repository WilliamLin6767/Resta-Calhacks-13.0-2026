import Anthropic from "@anthropic-ai/sdk";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { replyToOwner, takeTurns } from "@/lib/voice/reply";
import { signalAfter } from "@/lib/live/signal";

const perVisitor = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });
const wholeApp = createRateLimiter({ limit: 300, windowMs: 24 * 60 * 60 * 1000 });

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// POST /api/chat  { messages: [{ role, content }] }  The last message is the owner's.
export async function POST(request: Request) {
  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) return errorResponse("You've sent a lot of messages in the last 10 minutes. Try again in a few minutes.", 429);
  const app = wholeApp("chat");
  if (!app.ok) return errorResponse("Chat has reached today's limit. Try again tomorrow.", 429);

  const body = await request.json().catch(() => null);
  const messages = takeTurns(body && typeof body === "object" ? (body as { messages?: unknown }).messages : null);
  if (!messages) return errorResponse("Send a message.", 400);

  try {
    const { answer, order } = await replyToOwner(messages, false);
    if (order) signalAfter("/api/chat");
    return Response.json({ answer, order });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return errorResponse("The Anthropic API key is missing or invalid.", 500);
    if (err instanceof Anthropic.RateLimitError) return errorResponse("Too many AI requests right now. Wait a minute and try again.", 429);
    const message = err instanceof Error ? err.message : "The assistant failed.";
    const status = message.startsWith("The assistant declined") ? 422 : 502;
    return errorResponse(message, status);
  }
}
