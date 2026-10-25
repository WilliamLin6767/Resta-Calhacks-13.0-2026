// A simple fixed-window rate limiter, kept in memory.
// It resets when the server restarts, and each server instance has its own count,
// so on a host that runs several instances the real limit is higher. Fine for a demo.

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const windows = new Map<string, { start: number; count: number }>();

  return function check(key: string, now: number = Date.now()): RateLimitResult {
    let w = windows.get(key);
    // Start a new window if there is none or the old one has ended.
    if (!w || now - w.start >= windowMs) {
      w = { start: now, count: 0 };
      windows.set(key, w);
    }
    if (w.count >= limit) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) };
    }
    w.count += 1;
    return { ok: true };
  };
}

// For routes that move money, change prices or reach outside the restaurant: a 429 response
// when this visitor is over the limit, otherwise null.
//
//   const tooMany = limitResponse(perVisitor, request);
//   if (tooMany) return tooMany;
export function limitResponse(check: (key: string) => RateLimitResult, request: Request): Response | null {
  const result = check(clientIp(request));
  if (result.ok) return null;
  return Response.json(
    { error: `Too many requests. Try again in ${result.retryAfterSeconds} seconds.` },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

// The visitor's IP address, as reported by the hosting proxy.
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
