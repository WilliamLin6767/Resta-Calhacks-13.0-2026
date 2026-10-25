// The owner's login (server only). One password (OWNER_PASSWORD); a successful login gets a
// cookie signed with SESSION_SECRET that lasts 7 days. proxy.ts checks it on every request and
// lib/auth.ts checks it again inside routes that write. Plain functions, so they can be tested.
//
// Cookie value: "v1.<expires ms>.<random>.<signature>", the signature an HMAC-SHA256 of the rest.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "resta_session";
export const SESSION_DAYS = 7;
export const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const MIN_SECRET = 32; // characters

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

// Compare two strings in constant time (hashing first makes the lengths equal).
function sameText(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function signSession(secret: string, now = Date.now()): string {
  const payload = `v1.${now + SESSION_MS}.${randomBytes(12).toString("base64url")}`;
  return `${payload}.${sign(payload, secret)}`;
}

// True only for a cookie this server signed that hasn't expired.
export function verifySession(value: string | undefined | null, secret: string, now = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const payload = parts.slice(0, 3).join(".");
  if (!sameText(sign(payload, secret), parts[3])) return false;
  const expires = Number(parts[1]);
  return Number.isFinite(expires) && expires > now;
}

export function passwordMatches(given: string, expected: string): boolean {
  return sameText(given, expected);
}

// How login is set up. Login is opt-in: with no OWNER_PASSWORD the app is "open" everywhere
// (every page and route allowed, with a warning in the server log). "broken": a password is set but
// the session secret is missing or too short, so every request gets a clear error.
// Open in production still can't dial a real supplier (lib/calls/phone.ts dialBlocked) and still
// needs a tap in Actions for anything that spends money, changes a price or contacts someone.
export type AuthConfig =
  | { mode: "on"; password: string; secret: string }
  | { mode: "open" }
  | { mode: "broken"; error: string };

export function authConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const password = env.OWNER_PASSWORD ?? "";
  const secret = env.SESSION_SECRET ?? "";
  if (!password) return { mode: "open" };
  if (secret.length < MIN_SECRET) {
    return { mode: "broken", error: `SESSION_SECRET is missing or shorter than ${MIN_SECRET} characters. Add a long random value to the server's environment.` };
  }
  return { mode: "on", password, secret };
}

// Paths anyone can reach: the login page and its route, the loop tick (it checks CRON_SECRET
// itself), the inbound email webhook (it checks INBOUND_EMAIL_SECRET itself), and the static files the browser needs to draw the login page and install the app.
const PUBLIC_EXACT = new Set([
  "/login",
  "/api/login",
  "/api/logout",
  "/api/loop/tick",
  "/api/inbound/email",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || pathname.startsWith("/_next/static/") || pathname.startsWith("/_next/image");
}

// The session cookie's value from a Cookie header.
export function cookieFrom(header: string | null, name = SESSION_COOKIE): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return undefined;
}

// The one check shared by proxy.ts and requireOwner: is this request from the owner?
export function isAllowed(request: Request, config: AuthConfig): boolean {
  if (config.mode === "open") return true;
  if (config.mode === "broken") return false;
  return verifySession(cookieFrom(request.headers.get("cookie")), config.secret);
}

// Who approved something, for the action log: "owner" plus a short piece of this session's random
// part (never the signature), so two devices can be told apart.
export function sessionLabel(request: Request): string {
  const value = cookieFrom(request.headers.get("cookie"));
  const nonce = value?.split(".")[2];
  return nonce ? `owner:${nonce.slice(0, 8)}` : "owner";
}

let warned = false;
export function warnOpenOnce(log: (line: string) => void = console.warn) {
  if (warned) return;
  warned = true;
  log("[auth] OWNER_PASSWORD is not set: every page and route is open to anyone with the link. Set it to turn the login back on.");
}
