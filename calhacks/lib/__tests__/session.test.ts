import { NextRequest } from "next/server";
import { getRedirectUrl } from "next/experimental/testing/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { dialBlocked } from "@/lib/calls/phone";
import {
  authConfig,
  cookieFrom,
  isPublicPath,
  passwordMatches,
  SESSION_COOKIE,
  SESSION_MS,
  signSession,
  verifySession,
} from "@/lib/session";

const SECRET = "s".repeat(40);
const OTHER = "o".repeat(40);

describe("session cookie", () => {
  it("verifies a cookie it signed, until it expires", () => {
    const now = 1_700_000_000_000;
    const cookie = signSession(SECRET, now);
    expect(verifySession(cookie, SECRET, now)).toBe(true);
    expect(verifySession(cookie, SECRET, now + SESSION_MS - 1)).toBe(true);
    expect(verifySession(cookie, SECRET, now + SESSION_MS)).toBe(false); // expired
  });

  it("rejects a tampered cookie, another secret, or junk", () => {
    const now = Date.now();
    const cookie = signSession(SECRET, now);
    const [v, , nonce, sig] = cookie.split(".");
    const longer = `${v}.${now + 10 * SESSION_MS}.${nonce}.${sig}`; // pushed the expiry out
    expect(verifySession(longer, SECRET, now)).toBe(false);
    expect(verifySession(`${cookie.slice(0, -2)}xx`, SECRET, now)).toBe(false);
    expect(verifySession(cookie, OTHER, now)).toBe(false);
    for (const junk of [undefined, "", "v1", "v1.a.b", "v2.1.2.3", "a.b.c.d.e"]) expect(verifySession(junk, SECRET, now)).toBe(false);
  });

  it("compares passwords exactly", () => {
    expect(passwordMatches("pho tai", "pho tai")).toBe(true);
    expect(passwordMatches("pho ta", "pho tai")).toBe(false);
    expect(passwordMatches("", "pho tai")).toBe(false);
  });

  it("reads the cookie from a Cookie header", () => {
    expect(cookieFrom(`a=1; ${SESSION_COOKIE}=abc.def; b=2`)).toBe("abc.def");
    expect(cookieFrom("a=1")).toBeUndefined();
    expect(cookieFrom(null)).toBeUndefined();
  });
});

describe("authConfig", () => {
  it("is open in development without a password, and broken in production", () => {
    expect(authConfig({ NODE_ENV: "development" })).toEqual({ mode: "open" });
    expect(authConfig({ NODE_ENV: "production" }).mode).toBe("broken");
  });
  it("needs a long session secret once a password is set", () => {
    expect(authConfig({ NODE_ENV: "development", OWNER_PASSWORD: "x", SESSION_SECRET: "short" }).mode).toBe("broken");
    expect(authConfig({ NODE_ENV: "production", OWNER_PASSWORD: "x", SESSION_SECRET: SECRET })).toEqual({ mode: "on", password: "x", secret: SECRET });
  });
});

describe("allow list", () => {
  it("lets the login page, its route, the loop tick and static files through", () => {
    for (const p of ["/login", "/api/login", "/api/logout", "/api/loop/tick", "/api/inbound/email", "/manifest.webmanifest", "/icon-192.png", "/apple-touch-icon.png", "/favicon.ico", "/_next/static/chunks/a.js"]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });
  it("keeps everything else behind the login", () => {
    for (const p of ["/", "/chat", "/login/x", "/api/chat", "/api/calls/1/decide", "/api/loop/tick/x", "/api/inbound/1/confirm", "/api/inbound/check", "/samples/receipt.jpg"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe("proxy", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = () => {
    vi.stubEnv("OWNER_PASSWORD", "pho tai");
    vi.stubEnv("SESSION_SECRET", SECRET);
  };
  const req = (path: string, init: { cookie?: string; method?: string } = {}) =>
    new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers: init.cookie ? { cookie: `${SESSION_COOKIE}=${init.cookie}` } : {} });
  const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

  it("sends pages to /login and refuses API routes without a session", async () => {
    on();
    expect(getRedirectUrl(proxy(req("/inventory?x=1")) as never)).toBe("http://localhost/login?next=%2Finventory%3Fx%3D1");
    const api = proxy(req("/api/calls/1/decide", { method: "POST" }));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "Log in first." });
  });

  it("lets a signed session and the public paths through", () => {
    on();
    expect(passes(proxy(req("/inventory", { cookie: signSession(SECRET) })))).toBe(true);
    expect(passes(proxy(req("/api/chat", { method: "POST", cookie: signSession(SECRET) })))).toBe(true);
    expect(passes(proxy(req("/login")))).toBe(true);
    expect(passes(proxy(req("/api/loop/tick", { method: "POST" })))).toBe(true);
    expect(proxy(req("/api/chat", { method: "POST", cookie: signSession(OTHER) })).status).toBe(401);
  });

  it("serves nothing in production without a password", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OWNER_PASSWORD", "");
    expect(proxy(req("/")).status).toBe(503);
    expect(proxy(req("/login")).status).toBe(503);
  });
});

describe("dialBlocked", () => {
  it("blocks calls in production without a demo override number", () => {
    expect(dialBlocked({ NODE_ENV: "production" })).toMatch(/DEMO_CALL_OVERRIDE_NUMBER/);
    expect(dialBlocked({ NODE_ENV: "production", DEMO_CALL_OVERRIDE_NUMBER: "not a number" })).toMatch(/DEMO_CALL_OVERRIDE_NUMBER/);
    expect(dialBlocked({ NODE_ENV: "production", DEMO_CALL_OVERRIDE_NUMBER: "510-555-0103" })).toBeNull();
    expect(dialBlocked({ NODE_ENV: "development" })).toBeNull();
  });
});
