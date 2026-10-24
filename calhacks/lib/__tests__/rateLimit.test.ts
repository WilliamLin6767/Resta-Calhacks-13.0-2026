import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";

describe("createRateLimiter", () => {
  const minute = 60_000;

  it("allows up to the limit, then blocks", () => {
    const check = createRateLimiter({ limit: 3, windowMs: minute });
    expect(check("a", 0)).toEqual({ ok: true });
    expect(check("a", 1)).toEqual({ ok: true });
    expect(check("a", 2)).toEqual({ ok: true });
    expect(check("a", 1000)).toEqual({ ok: false, retryAfterSeconds: 59 });
  });

  it("resets after the window", () => {
    const check = createRateLimiter({ limit: 1, windowMs: minute });
    expect(check("a", 0).ok).toBe(true);
    expect(check("a", minute - 1).ok).toBe(false);
    expect(check("a", minute).ok).toBe(true);
  });

  it("keeps keys separate", () => {
    const check = createRateLimiter({ limit: 1, windowMs: minute });
    expect(check("a", 0).ok).toBe(true);
    expect(check("a", 1).ok).toBe(false);
    expect(check("b", 2).ok).toBe(true);
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost", { headers });

  it("uses the first x-forwarded-for value", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(req({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
