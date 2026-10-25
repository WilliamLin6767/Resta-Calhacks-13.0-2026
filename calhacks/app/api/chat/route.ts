import { requireOwner } from "@/lib/auth";
import { agentLimit } from "@/lib/agent/http";
import { agentErrorResponse, runAgent, takeTurns } from "@/lib/agent/run";
import { parseHistory } from "@/lib/agent/undo";
import { signalAfter } from "@/lib/live/signal";
import { clientIp } from "@/lib/rateLimit";

// POST /api/chat  { messages: [{ role, content }], changes?: [earlier changes], page? }  The last message is the owner's.
// Returns { answer, order, changes, links, proposals }. A thin wrapper around the one agent (lib/agent/run.ts).
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const limited = agentLimit(request, "chat");
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const input = body && typeof body === "object" ? (body as { messages?: unknown; changes?: unknown; page?: unknown }) : {};
  const messages = takeTurns(input.messages ?? null);
  if (!messages) return Response.json({ error: "Send a message." }, { status: 400 });

  try {
    const { answer, order, changes, links, proposals } = await runAgent({
      surface: "chat",
      messages,
      identity: clientIp(request),
      history: parseHistory(input.changes),
      page: typeof input.page === "string" ? input.page.slice(0, 200) : undefined,
    });
    if (order || changes.length) signalAfter("/api/chat");
    return Response.json({ answer, order, changes, links, proposals });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
