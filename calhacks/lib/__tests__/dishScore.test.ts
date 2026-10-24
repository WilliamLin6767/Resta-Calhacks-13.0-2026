import { describe, expect, it } from "vitest";
import {
  compareRecommendations,
  isOnMenu,
  recommendationReason,
  scoreDishes,
  splitIngredients,
  type DishInput,
} from "../trends/score";
import { dishesFromItems, listingsFromItems, pickRestaurants, searchLocation } from "../trends/yelp";
import { instagramPosts, socialQueries, tiktokPosts } from "../trends/social";

const menu = ["Pho Tai (rare beef)", "Bun Bo Hue"];

function dish(partial: Partial<DishInput> & Pick<DishInput, "name">): DishInput {
  return { have: ["Brisket"], need: [], yelp: [], social: [], ...partial };
}

describe("isOnMenu", () => {
  it("matches a menu name after dropping the parenthetical and accents", () => {
    expect(isOnMenu("Pho Tai", menu)).toBe(true);
    expect(isOnMenu("Bún Bò Huế", menu)).toBe(true);
    expect(isOnMenu("Pho Ga", menu)).toBe(false);
  });
});

describe("splitIngredients", () => {
  const pantry = ["Brisket", "Rice noodles", "Limes"];

  it("copies a stocked name and keeps a genuinely new one", () => {
    expect(splitIngredients(["beef brisket", "rice", "Limes"], pantry)).toEqual({
      have: ["Brisket", "Limes"],
      need: ["rice"],
    });
  });

  it("prefers the longer stocked name when both could match", () => {
    expect(splitIngredients(["rice noodles"], ["Rice", "Rice noodles"]).have).toEqual(["Rice noodles"]);
  });
});

describe("scoreDishes", () => {
  it("weights yelp and social, then multiplies by the share of ingredients already in stock", () => {
    const scored = scoreDishes(
      [
        dish({
          name: "Com ga",
          have: ["Brisket"],
          need: [],
          yelp: [{ business: "A", rating: 5, reviewCount: 10, url: "https://www.yelp.com/biz/a" }],
          social: [{ platform: "tiktok", url: "https://www.tiktok.com/v/1", views: 9, likes: 0 }],
        }),
        dish({
          name: "Hu tieu",
          yelp: [],
          social: [{ platform: "instagram", url: "https://www.instagram.com/p/abc/", views: 99, likes: 0 }],
        }),
      ],
      menu,
    );
    // Com ga is on both sides: 0.6 * 1 + 0.4 * (1 / 2). Hu tieu is social only, so that side is the whole score.
    expect(scored.map((row) => row.dish_name)).toEqual(["Hu tieu", "Com ga"]);
    expect(scored[1]).toMatchObject({ demand_score: 0.8, fit_score: 1, recommend_score: 0.8, new_ingredient_count: 0 });
    expect(scored[0].demand_score).toBe(1);
  });

  it("uses yelp alone at full weight and ranks a lighter shopping list ahead of a bigger one", () => {
    const scored = scoreDishes(
      [
        dish({
          name: "Pho Tai",
          yelp: [{ business: "A", rating: 5, reviewCount: 100, url: "" }],
        }),
        dish({
          name: "Banh khot",
          have: ["Brisket", "Rice noodles"],
          need: ["Lemongrass"],
          yelp: [{ business: "A", rating: 5, reviewCount: 100, url: "https://www.yelp.com/biz/a" }],
        }),
        dish({
          name: "Bun cha",
          have: ["Brisket"],
          need: [],
          yelp: [{ business: "B", rating: 5, reviewCount: 40, url: "https://www.yelp.com/biz/b" }],
        }),
        dish({
          name: "Bo kho",
          have: ["Brisket", "Rice noodles", "Limes", "Onion", "Garlic", "Ginger"],
          need: ["Lemongrass", "Star anise", "Cinnamon", "Fish sauce"],
          yelp: [{ business: "C", rating: 5, reviewCount: 100, url: "https://www.yelp.com/biz/c" }],
        }),
      ],
      menu,
    );
    expect(scored.map((row) => row.dish_name)).toEqual(["Banh khot", "Bun cha", "Bo kho"]);
    expect(scored[0].recommend_score).toBeCloseTo(0.667, 3);
    expect(scored[1].recommend_score).toBe(0.4);
    expect(scored[2].new_ingredient_count).toBe(4);
    expect(compareRecommendations(scored[2], scored[0])).toBeGreaterThan(0);
  });

  it("gives a dish with no ingredient list a fit of zero", () => {
    const scored = scoreDishes([dish({ name: "Che", have: [], need: [], yelp: [{ business: "A", rating: 5, reviewCount: 10, url: "" }] })], []);
    expect(scored[0]).toMatchObject({ fit_score: 0, recommend_score: 0 });
  });

  it("writes the reason from the counts, not from the model", () => {
    const text = recommendationReason({
      yelp: [
        { business: "A", rating: 4.5, reviewCount: 40, url: "" },
        { business: "B", rating: 4, reviewCount: 46, url: "" },
      ],
      social: [
        { platform: "tiktok", url: "", views: 1, likes: 1 },
        { platform: "instagram", url: "", views: 1, likes: 1 },
        { platform: "tiktok", url: "", views: 1, likes: 1 },
        { platform: "instagram", url: "", views: 1, likes: 1 },
      ],
      have: ["Brisket", "Rice noodles"],
      need: ["Lemongrass"],
    });
    expect(text).toBe(
      "Mentioned on 2 Yelp menus (86 reviews) and 4 posts. You already stock Brisket and Rice noodles. You would buy Lemongrass.",
    );
  });
});

describe("yelp and social parsers", () => {
  it("keeps Berkeley listings and drops this restaurant", () => {
    const listings = listingsFromItems([
      { name: "Pho Berkeley", alias: "pho-berkeley-berkeley", avg_rating: 4.2, review_count: 800, city: "Berkeley" },
      { name: "Saigon Express", alias: "saigon-express-berkeley", avg_rating: 4.6, review_count: 200, city: "Berkeley" },
      { name: "Oakland Pho", alias: "oakland-pho-oakland", avg_rating: 4.9, review_count: 900, city: "Oakland" },
      { status: "not_found", url: "https://www.yelp.com/biz/missing" },
    ]);
    const picked = pickRestaurants(listings, "Pho Berkeley");
    expect(picked.map((row) => row.name)).toEqual(["Saigon Express"]);
    expect(picked[0].url).toBe("https://www.yelp.com/biz/saigon-express-berkeley");
  });

  it("reads a popular dish and falls back to the average rating when the row has no restaurant", () => {
    const restaurants = pickRestaurants(
      listingsFromItems([
        { name: "Lan", alias: "lan-berkeley", avg_rating: 4, review_count: 10, city: "Berkeley" },
        { name: "Mai", alias: "mai-berkeley", avg_rating: 5, review_count: 10, city: "Berkeley" },
      ]),
      "Pho Berkeley",
    );
    const dishes = dishesFromItems(
      [
        { display_name: "Broken rice", review_count: 12, url: "https://www.yelp.com/biz/lan-berkeley" },
        { display_name: "Shaking beef", review_count: 8 },
      ],
      restaurants,
    );
    expect(dishes[0]).toMatchObject({ name: "Broken rice", business: "Lan", rating: 4 });
    expect(dishes[1]).toMatchObject({ name: "Shaking beef", business: "Yelp", rating: 4.5 });
  });

  it("reads a street address as city and state", () => {
    expect(searchLocation("2115 Kittredge St, Berkeley, CA 94704")).toBe("Berkeley, CA");
    expect(searchLocation(null)).toBe("Berkeley, CA");
  });

  it("keeps caption, url, and counts, and drops the account", () => {
    const [post] = instagramPosts([
      {
        caption: "shaking beef in berkeley",
        url: "https://www.instagram.com/p/abc/",
        videoViewCount: 1000,
        likesCount: 20,
        ownerUsername: "secret_chef",
        latestComments: [{ text: "private note", ownerUsername: "fan" }],
      },
    ]);
    expect(post).toEqual({
      platform: "instagram",
      url: "https://www.instagram.com/p/abc/",
      views: 1000,
      likes: 20,
      caption: "shaking beef in berkeley",
    });
    expect(JSON.stringify(post)).not.toContain("secret_chef");

    const [video] = tiktokPosts([
      { text: "bun bo hue recipe", webVideoUrl: "https://www.tiktok.com/video/1", playCount: 50, diggCount: 5, authorMeta: { name: "secret_chef" } },
    ]);
    expect(video.caption).toBe("bun bo hue recipe");
    expect(JSON.stringify(video)).not.toContain("secret_chef");
    expect(socialQueries("Vietnamese").instagram).toBe("Vietnamese food berkeley, pho");
  });
});
