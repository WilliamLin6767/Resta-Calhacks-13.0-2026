import { requireOwner } from "@/lib/auth";
import { agentLimit } from "@/lib/agent/http";
import { agentErrorResponse, runAgent, takeTurns } from "@/lib/agent/run";
import { parseHistory } from "@/lib/agent/undo";
import { signalAfter } from "@/lib/live/signal";
import { clientIp } from "@/lib/rateLimit";

const SURFACES = ["chat", "voice", "panel"] as const;

// POST /api/agent   { surface?: "chat" | "voice" | "panel", messages: [{ role, content }], changes?: [earlier changes], page? }
// The one agent. The last message is the owner's (for voice, already transcribed).
// Returns { answer, changes, proposals, links, charts, order }.
// /api/chat, /api/voice and /api/assistant are thin wrappers around the same runAgent.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const input = body && typeof body === "object" ? (body as { surface?: unknown; messages?: unknown; changes?: unknown; page?: unknown }) : {};
  const surface = SURFACES.find((s) => s === input.surface) ?? "chat";
  const limited = agentLimit(request, surface);
  if (limited) return limited;
  const messages = takeTurns(input.messages ?? null);
  if (!messages) return Response.json({ error: "Send a message." }, { status: 400 });

  try {
    const result = await runAgent({
      surface,
      messages,
      identity: clientIp(request),
      history: parseHistory(input.changes),
      page: typeof input.page === "string" ? input.page.slice(0, 200) : undefined,
    });
    if (result.order || result.changes.length) signalAfter("/api/agent");
    return Response.json(result);
  } catch (err) {
    return agentErrorResponse(err);
  }
}
