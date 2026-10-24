// Cartesia stays on the server. The browser only sends a finished voice clip and plays the reply.

const VERSION = "2026-08-14";
const VOICE_ID = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc";

function headers(token: string, json: boolean): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Cartesia-Version": VERSION,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function transcriptFrom(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as { text?: unknown; transcript?: unknown };
  if (typeof record.text === "string") return record.text.trim();
  if (typeof record.transcript === "string") return record.transcript.trim();
  return "";
}

export async function transcribe(token: string, audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "ink-whisper");
  form.append("language", "en");
  const res = await fetch("https://api.cartesia.ai/stt?model=ink-whisper&language=en", {
    method: "POST",
    headers: headers(token, false),
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body ? String((body as { message?: unknown }).message) : res.statusText;
    throw new Error(message || "Cartesia could not transcribe that.");
  }
  return transcriptFrom(body);
}

export async function speak(token: string, transcript: string): Promise<Uint8Array> {
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: headers(token, true),
    body: JSON.stringify({
      model_id: "sonic-3.6",
      transcript,
      voice: { id: VOICE_ID },
      language: "en",
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body && typeof body === "object" && "message" in body ? String((body as { message?: unknown }).message) : res.statusText;
    throw new Error(message || "Cartesia could not speak the reply.");
  }
  return new Uint8Array(await res.arrayBuffer());
}
