// Simple limits on AI requests, because each one costs money. Kept in memory, so they're per
// server process and reset on restart: enough to stop a stuck button or a script, not an attacker.
type Result = { ok: true } | { ok: false; retryAfterSeconds: number };

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string, now = Date.now()): Result => {
    const w = windows.get(key);
    if (!w || now - w.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      return { ok: true };
    }
    if (w.count >= limit) return { ok: false, retryAfterSeconds: Math.ceil((w.start + windowMs - now) / 1000) };
    w.count++;
    return { ok: true };
  };
}

// The visitor's address, for per-visitor limits
export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}
