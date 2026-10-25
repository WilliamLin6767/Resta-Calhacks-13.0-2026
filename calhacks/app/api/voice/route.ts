import { requireOwner } from "@/lib/auth";
import { agentLimit } from "@/lib/agent/http";
import { agentErrorResponse, runAgent, takeTurns, type RunResult } from "@/lib/agent/run";
import { parseHistory } from "@/lib/agent/undo";
import { signalAfter } from "@/lib/live/signal";
import { clientIp } from "@/lib/rateLimit";
import { speak, transcribe } from "@/lib/voice/cartesia";

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// A JSON form field, or null.
function jsonField(form: FormData | null, name: string): unknown {
  const raw = form?.get(name);
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function historyFrom(form: FormData | null) {
  const parsed = jsonField(form, "history");
  return Array.isArray(parsed) ? parsed : [];
}

// POST /api/voice  multipart file, plus history: the earlier turns as JSON, and changes: the
// earlier changes as JSON. Returns { transcript, answer, audio, audioType, order, changes, links, proposals }.
// Cartesia turns speech into text, the one agent (lib/agent/run.ts) answers, Cartesia speaks it.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const token = process.env.CARTESIA_API_KEY;
  if (!token) return errorResponse("CARTESIA_API_KEY is missing. Add it on the server, not as NEXT_PUBLIC.", 500);
  const limited = agentLimit(request, "voice");
  if (limited) return limited;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return errorResponse("No voice clip was sent.", 400);
  if (file.size > 8_000_000) return errorResponse("That clip is too long. Hold to talk for a shorter request.", 413);

  let transcript = "";
  try {
    transcript = await transcribe(token, file, file.name || "clip.webm");
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Could not transcribe that.", 502);
  }
  if (!transcript) return errorResponse("I didn't catch that. Hold the button and try again.", 400);

  const said = { role: "user" as const, content: transcript.slice(0, 2000) };
  const messages = takeTurns([...historyFrom(form), said]) ?? takeTurns([said]);
  if (!messages) return errorResponse("I didn't catch that. Hold the button and try again.", 400);

  let result: RunResult;
  try {
    result = await runAgent({ surface: "voice", messages, identity: clientIp(request), history: parseHistory(jsonField(form, "changes")) });
  } catch (err) {
    return agentErrorResponse(err);
  }
  const { answer, order, changes, links, proposals } = result;

  let audio: string | null = null;
  try {
    const bytes = await speak(token, answer.slice(0, 800));
    audio = Buffer.from(bytes).toString("base64");
  } catch {
    audio = null;
  }

  if (order || changes.length) signalAfter("/api/voice");
  return Response.json({ transcript, answer, audio, audioType: "audio/mpeg", order, changes, links, proposals });
}
