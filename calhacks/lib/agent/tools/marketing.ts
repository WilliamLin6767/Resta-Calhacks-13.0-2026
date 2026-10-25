// Marketing: the drafted and posted Instagram posts, campaign_options (what is worth promoting,
// from margins, sales trends, stock and posting history) and draft_campaign (one draft post for
// a candidate and an allowed offer). Publishing is always a Commit action the owner approves.
import { z } from "zod";
import { loadAnalytics } from "@/app/analytics/data";
import { loadInventory, todayLocal } from "@/lib/inventory/service";
import { recentLessons } from "@/lib/loop/store";
import { draftPosts, voiceFor } from "@/lib/marketing/draft";
import { saveFreshPhoto } from "@/lib/marketing/photo";
import { RESTAURANT_ID } from "@/lib/supabase";
import { loadDishes, loadDishSales, loadRecipes, loadSaleLines } from "../evidence";
import { campaignOptions, DAYPARTS, dishStockUnits, forecastDishWeek, type Daypart } from "../investigate";
import { checkDiscount } from "../limits";
import { resolveOne } from "../resolve";
import { ask, capped, changed, json, defineTool } from "../types";

const DAYPART_IDS = Object.keys(DAYPARTS) as [Daypart, ...Daypart[]];
export const OFFERS = ["feature", "drink_bundle", "discount"] as const;
export type OfferKind = (typeof OFFERS)[number];
const isDrink = (category: string | null) => /drink|beverage/i.test(category ?? "");

// The offer in words, for the post and the summaries
export function offerText(offer: OfferKind, dish: string, discount: number, drink: string | null) {
  if (offer === "drink_bundle" && drink) return `${dish} with a ${drink}`;
  if (offer === "discount" && discount > 0) return `$${discount.toFixed(2)} off ${dish}`;
  return `Featuring ${dish}`;
}

export const marketingTools = [
  defineTool({
    name: "draft_campaign",
    tier: "draft",
    area: "marketing",
    description:
      "Draft one Instagram post for a campaign_options candidate with one allowed offer: feature, drink_bundle, or discount (up to $2, only while food cost stays " +
      "on target). It waits on the Marketing page; nothing is posted. Returns the post_id for start_promotion.",
    input: z.object({ dish: z.string(), offer: z.enum(OFFERS), discount_usd: z.number().min(0).max(2).optional(), daypart: z.enum(DAYPART_IDS).optional() }),
    run: async ({ dish, offer, discount_usd, daypart }, ctx) => {
      const [dishes, analytics, restaurant] = await Promise.all([
        loadDishes(ctx.db),
        loadAnalytics(30),
        ctx.db.from("restaurants").select("name, cuisine, address").eq("id", RESTAURANT_ID).maybeSingle(),
      ]);
      const found = resolveOne(dishes.filter((d) => !isDrink(d.category)), dish, (d) => d.name, "dish");
      if (!found.ok) return ask(found.ask);
      const d = found.item;
      const row = "error" in analytics ? undefined : analytics.digest.menu.find((m) => m.name.trim().toLowerCase() === d.name.trim().toLowerCase());
      const discount = offer === "discount" ? (discount_usd ?? 0) : 0;
      if (offer === "discount") {
        if (!row || row.unit_food_cost === null) return "Error: the food cost for this dish is unknown, so a discount can't be checked. Use feature or drink_bundle.";
        const limit = checkDiscount(discount, d.price, row.unit_food_cost);
        if (!limit.ok) return `Error: ${limit.reason}`;
      }
      const drink = offer === "drink_bundle" ? (dishes.find((x) => isDrink(x.category))?.name ?? null) : null;
      if (offer === "drink_bundle" && !drink) return "Error: there's no drink on the menu to bundle.";
      const pitch = offerText(offer, d.name, discount, drink);
      const [post] = await draftPosts({
        name: restaurant.data?.name ?? "the restaurant",
        cuisine: restaurant.data?.cuisine ?? null,
        address: restaurant.data?.address ?? null,
        slots: [{ kind: "boost", dish: d.name, why: `${pitch}${daypart ? ` at ${daypart}` : ""}. Say the offer plainly.`, look: "classic" }],
        voice: voiceFor(Math.floor(Date.now() / 1000)),
      });
      if (!post) return "Error: the post couldn't be drafted.";
      const inserted = await ctx.db
        .from("marketing_posts")
        .insert({ restaurant_id: RESTAURANT_ID, layout: post.layout, dish_name: post.dish_name, headline: post.headline, subhead: post.subhead, caption: post.caption, hashtags: post.hashtags, status: "draft" })
        .select("id")
        .single();
      if (inserted.error) return `Error: ${inserted.error.message}`;
      const id = (inserted.data as { id: number }).id;
      await saveFreshPhoto(ctx.db, id, post.dish_name, id).catch(() => undefined);
      return changed(
        ctx,
        { kind: "campaign_drafted", label: `Drafted post #${id}: ${post.headline} (${pitch}), waiting on Marketing`, before: null, after: id },
        { post_id: id, preview: "/marketing", menu_item_id: d.id, offer, discount_usd: discount, daypart: daypart ?? null },
      );
    },
  }),
  defineTool({
    name: "list_marketing_posts",
    tier: "read",
    area: "marketing",
    description: "The Instagram posts: drafts waiting on the Marketing page, posted ones (with their link and date) and failed ones (with the error).",
    input: z.object({ status: z.enum(["draft", "posted", "failed", "all"]).optional() }),
    run: async ({ status }, ctx) => {
      let q = ctx.db.from("marketing_posts").select("id, status, dish_name, headline, caption, created_at, posted_at, external_link, error").eq("restaurant_id", RESTAURANT_ID).order("created_at", { ascending: false }).limit(60);
      if (status && status !== "all") q = q.eq("status", status);
      const res = await q;
      if (res.error) return `Error: ${res.error.message}${/marketing_posts|schema cache/i.test(res.error.message) ? ". Has supabase/16_marketing.sql been run?" : ""}`;
      return json(capped(res.data ?? []));
    },
  }),
  defineTool({
    name: "campaign_options",
    tier: "read",
    area: "marketing",
    description:
      "What to promote this week: for each dish, margin in dollars, the sales trend (overall and for a daypart), whether stock covers a promo week " +
      "(forecast x 1.3, an assumed lift), and days since it was last posted. Ranked, with the offers allowed for each (feature only, a drink bundle, " +
      "or up to $2 off only while food cost stays on target), plus trending dishes not on the menu. daypart: lunch or dinner (optional).",
    input: z.object({ daypart: z.enum(DAYPART_IDS).optional(), days: z.union([z.literal(14), z.literal(28), z.literal(30)]).optional() }),
    run: async ({ daypart, days }, ctx) => {
      const period = days ?? 28;
      const now = new Date();
      const [dishes, analytics, sales, history, recipes, inventory, posts, trends, lessons] = await Promise.all([
        loadDishes(ctx.db),
        loadAnalytics(30),
        loadSaleLines(ctx.db, new Date(now.getTime() - 2 * period * 86400_000).toISOString()),
        loadDishSales(ctx.db, 56),
        loadRecipes(ctx.db),
        loadInventory(ctx.db),
        ctx.db.from("marketing_posts").select("dish_name, posted_at, status, created_at").eq("restaurant_id", RESTAURANT_ID).in("status", ["posted", "draft", "publishing"]),
        ctx.db.from("dish_recommendations").select("dish_name, recommend_score").eq("restaurant_id", RESTAURANT_ID).order("recommend_score", { ascending: false }).limit(10),
        recentLessons(ctx.db, "sales_dip", 5),
      ]);
      if ("error" in analytics) return `Error: the analytics are unavailable (${analytics.error}).`;
      // When each dish was last posted. A draft from the last 7 days counts as just posted, so two
      // promotions don't pick the same dish.
      const lastPosted = new Map<string, string>();
      const weekAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();
      for (const p of (posts.data ?? []) as { dish_name: string; posted_at: string | null; status: string; created_at: string }[]) {
        const k = p.dish_name.trim().toLowerCase();
        const at = p.status === "posted" ? p.posted_at : p.created_at >= weekAgo ? p.created_at : null;
        if (at && (!lastPosted.has(k) || at > lastPosted.get(k)!)) lastPosted.set(k, at);
      }
      const onHand = new Map(inventory.lines.map((l) => [l.id, l.estimated]));
      return json(
        campaignOptions({
          days: period,
          daypart,
          now: now.toISOString(),
          dishes,
          menu: analytics.digest.menu,
          sales,
          stockUnits: dishStockUnits(recipes, onHand),
          forecastWeek: forecastDishWeek(history, dishes, todayLocal()),
          lastPosted,
          trends: (trends.data ?? []) as { dish_name: string; recommend_score: number | null }[],
          lessons,
        }),
      );
    },
  }),
];
