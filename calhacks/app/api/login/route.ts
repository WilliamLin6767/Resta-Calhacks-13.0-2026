import { NextResponse } from "next/server";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { authConfig, passwordMatches, SESSION_COOKIE, SESSION_MS, signSession } from "@/lib/session";

// 10 tries per visitor per 15 minutes, so the password can't be guessed by brute force.
const perVisitor = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });

// POST /api/login   { "password": "..." }
// The right password sets the owner's session cookie (7 days).
export async function POST(request: Request) {
  const config = authConfig();
  if (config.mode === "broken") return Response.json({ error: config.error }, { status: 503 });
  if (config.mode === "open") return Response.json({ ok: true });

  const limited = perVisitor(clientIp(request));
  if (!limited.ok) {
    return Response.json(
      { error: "Too many tries. Wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || !passwordMatches(password, config.password)) {
    return Response.json({ error: "That password isn't right." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, signSession(config.secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
  return response;
}
