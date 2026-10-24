import Anthropic from "@anthropic-ai/sdk";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { speak, transcribe } from "@/lib/voice/cartesia";
import { replyToOwner, takeTurns, type DraftedOrder } from "@/lib/voice/reply";

const perVisitor = createRateLimiter({ limit: 80, windowMs: 10 * 60 * 1000 });
const wholeApp = createRateLimiter({ limit: 500, windowMs: 24 * 60 * 60 * 1000 });

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function historyFrom(form: FormData | null) {
  if (!form) return [];
  const raw = form.get("history");
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// POST /api/voice  multipart file, plus history: the earlier turns as JSON.
export async function POST(request: Request) {
  const token = process.env.CARTESIA_API_KEY;
  if (!token) return errorResponse("CARTESIA_API_KEY is missing. Add it on the server, not as NEXT_PUBLIC.", 500);

  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) return errorResponse("You've used voice a lot in the last 10 minutes. Try again in a few minutes.", 429);
  const app = wholeApp("voice");
  if (!app.ok) return errorResponse("Voice has reached today's limit. Try again tomorrow.", 429);

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

  let answer = "";
  let order: DraftedOrder | null = null;
  try {
    const result = await replyToOwner(messages, true);
    answer = result.answer;
    order = result.order;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return errorResponse("The Anthropic API key is missing or invalid.", 500);
    if (err instanceof Anthropic.RateLimitError) return errorResponse("Too many AI requests right now. Wait a minute and try again.", 429);
    const message = err instanceof Error ? err.message : "The assistant failed.";
    const status = message.startsWith("The assistant declined") ? 422 : 502;
    return errorResponse(message, status);
  }

  let audio: string | null = null;
  try {
    const bytes = await speak(token, answer.slice(0, 800));
    audio = Buffer.from(bytes).toString("base64");
  } catch {
    audio = null;
  }

  return Response.json({
    transcript,
    answer,
    audio,
    audioType: "audio/mpeg",
    order,
  });
}
