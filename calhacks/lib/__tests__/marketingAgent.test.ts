// Phase 6: drafts are archived not deleted, one publish per post, planWeek's skips, photo credits.
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ publishToInstagram: vi.fn() }));
vi.mock("@/lib/marketing/buffer", () => ({ bufferConfig: () => ({ key: "k", channelId: "c" }), publishToInstagram: m.publishToInstagram }));
vi.mock("@/lib/marketing/image", () => ({ renderPostJpeg: vi.fn(async () => Buffer.from("jpeg")) }));
vi.mock("@/lib/marketing/photo", async (orig) => ({ ...(await orig<typeof import("@/lib/marketing/photo")>()), loadPostPhoto: vi.fn(async () => undefined) }));

const { publishPost, PublishError } = await import("@/lib/marketing/publish");
const { creditLine, licenseLabel } = await import("@/lib/marketing/photo");
const { planWeek, eligible } = await import("@/lib/marketing/targets");

// One marketing post in memory, with Supabase's conditional update (status in [...]).
function postDb(status = "draft") {
  const post: Record<string, unknown> = { id: 5, restaurant_id: 1, layout: "plate", dish_name: "Bun Bo Hue", headline: "Lunch, sorted", subhead: "s", caption: "c", hashtags: [], status, credit: "Photo: Jane Doe, CC BY 2.0" };
  const query = (filters: { in?: string[] } = {}, patch?: Record<string, unknown>): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.neq = () => q;
    q.in = (_col: string, values: string[]) => query({ in: values }, patch);
    q.maybeSingle = async () => {
      await Promise.resolve();
      if (patch) {
        if (filters.in && !filters.in.includes(post.status as string)) return { data: null, error: null };
        Object.assign(post, patch);
      }
      return { data: { ...post }, error: null };
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (patch && (!filters.in || filters.in.includes(post.status as string))) Object.assign(post, patch);
      return resolve({ data: null, error: null });
    };
    return q;
  };
  const db = {
    from: () => ({ select: () => query(), update: (patch: Record<string, unknown>) => query({}, patch) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "https://x/p.jpg" } }) }) },
  } as unknown as SupabaseClient;
  return { db, post };
}

describe("publishing", () => {
  it("claims the post first, so two taps post it once", async () => {
    m.publishToInstagram.mockResolvedValue({ id: "b1", status: "sent", externalLink: "https://instagram.com/p/1", error: null });
    const { db, post } = postDb();
    const results = await Promise.allSettled([publishPost(db, 5), publishPost(db, 5)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(PublishError);
    expect(m.publishToInstagram).toHaveBeenCalledTimes(1);
    expect(post.status).toBe("posted");
    // The stock photo's credit went into the caption
    expect(m.publishToInstagram.mock.calls[0][0].text).toContain("Photo: Jane Doe, CC BY 2.0");
  });

  it("won't post a post that was already sent", async () => {
    m.publishToInstagram.mockClear();
    const { db } = postDb("posted");
    await expect(publishPost(db, 5)).rejects.toMatchObject({ status: 409 });
    expect(m.publishToInstagram).not.toHaveBeenCalled();
  });
});

describe("drafting a new set", () => {
  it("archives the old drafts and never deletes a post", () => {
    const src = readFileSync(new URL("../../app/api/marketing/draft/route.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\.delete\(|\.remove\(/);
    expect(src).toMatch(/status: "archived"/);
  });
});

describe("planWeek skips", () => {
  const base = { units_change_pct: -20, class: "puzzle" as const };
  it("skips dishes over the food-cost target, posted in the last 14 days, or without stock for a promo week", () => {
    const menu = [
      { name: "Pricey", units: 50, food_cost_pct: 35, ...base },
      { name: "Just posted", units: 50, posted_days_ago: 3, ...base },
      { name: "Short", units: 50, stock_covers: false, ...base },
      { name: "Bun Bo Hue", units: 80, margin_usd: 12.85, food_cost_pct: 22, posted_days_ago: 20, stock_covers: true, ...base },
      { name: "Com Tam", units: 60, margin_usd: 14.55, food_cost_pct: 14, ...base },
    ];
    const boosts = planWeek(menu, []).map((s) => s.dish);
    expect(boosts).toEqual(["Com Tam", "Bun Bo Hue"]); // higher margin in dollars first
    expect(eligible({ name: "x", units: 1, units_change_pct: null, class: null })).toBe(true); // unknown doesn't rule out
  });
});

describe("photo credits", () => {
  it("writes the caption's credit line from the creator and license", () => {
    expect(licenseLabel("by", "2.0")).toBe("CC BY 2.0");
    expect(licenseLabel("cc0")).toBe("CC0");
    expect(licenseLabel("pdm")).toBe("Public Domain Mark");
    expect(creditLine({ creator: "Jane Doe", license: "CC BY-SA 4.0", source_url: null })).toBe("Photo: Jane Doe, CC BY-SA 4.0");
    expect(creditLine({ creator: null, license: "CC0", source_url: null })).toBe("Photo: unknown creator, CC0");
  });
});
