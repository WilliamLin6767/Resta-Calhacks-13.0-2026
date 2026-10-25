import { describe, expect, it } from "vitest";
import { assignDishes, captionFor, cleanHashtags, pickDish, shapeDrafts } from "../marketing/copy";
import { parseHashtags, readPostEdit } from "../marketing/edit";
import { chooseDishPhoto, chosenPhoto, fallbackQuery, unusedHits } from "../marketing/photo";
import { dishPhotoPath, dishSlug } from "../marketing/photoPath";

const menu = ["Pho Tai (rare beef)", "Bun Bo Hue", "Com Tam"];

describe("pickDish", () => {
  it("keeps a dish that is on the allowed list", () => {
    expect(pickDish("Bun Bo Hue", menu)).toBe("Bun Bo Hue");
  });

  it("falls back to the first allowed dish when the name was invented", () => {
    expect(pickDish("Truffle foam", menu)).toBe("Pho Tai (rare beef)");
  });
});

describe("assignDishes", () => {
  it("gives a repeated name a different dish", () => {
    expect(assignDishes(["Pho Tai", "Pho Tai", "Pho Tai"], menu)).toEqual(["Pho Tai (rare beef)", "Bun Bo Hue", "Com Tam"]);
  });
});

describe("captionFor", () => {
  it("appends hashtags the caption does not already contain", () => {
    expect(captionFor("Come in for pho.", ["#PhoBerkeley", "#Berkeley"])).toBe("Come in for pho.\n\n#PhoBerkeley #Berkeley");
  });

  it("does not repeat a hashtag already written in the caption", () => {
    expect(captionFor("Come in for pho. #PhoBerkeley", ["#PhoBerkeley"])).toBe("Come in for pho. #PhoBerkeley");
  });
});

describe("parseHashtags", () => {
  it("splits an edited hashtag line", () => {
    expect(parseHashtags("#PhoBerkeley, lunch")).toEqual(["#PhoBerkeley", "#lunch"]);
  });
});

describe("readPostEdit", () => {
  it("rejects an empty headline", () => {
    expect(readPostEdit({ dishName: "Pho", headline: "  ", subhead: "", caption: "Come in.", hashtags: "" })).toEqual({
      error: "The headline can't be empty.",
    });
  });
});

describe("cleanHashtags", () => {
  it("adds a hash and drops duplicates", () => {
    expect(cleanHashtags(["pho berkeley", "#PhoBerkeley", "ok"])).toEqual(["#phoberkeley", "#ok"]);
  });
});

describe("dishSlug", () => {
  it("makes a stable storage path from a dish name", () => {
    expect(dishSlug("Phở Tái (rare beef)")).toBe("pho-tai-rare-beef");
    expect(dishPhotoPath("Phở Tái (rare beef)")).toBe("photos/pho-tai-rare-beef.jpg");
  });
});

describe("shapeDrafts", () => {
  it("clips a long headline and keeps three posts", () => {
    const [first] = shapeDrafts(
      [
        {
          layout: "plate",
          dish_name: "Com Tam",
          headline: "This headline is much too long to sit on a square image",
          subhead: "Broken rice, grilled pork, and the usual plate.",
          caption: "We are serving com tam tonight.",
          hashtags: ["comtam"],
        },
      ],
      menu,
    );
    expect(first.dish_name).toBe("Com Tam");
    expect(first.headline.endsWith("…")).toBe(true);
    expect(first.headline.length).toBeLessThanOrEqual(42);
    expect(first.hashtags).toEqual(["#comtam"]);
  });
});

describe("fallbackQuery", () => {
  it("keeps the dish words, including the note in parentheses", () => {
    expect(fallbackQuery("Phở Tái (rare beef)")).toBe("Pho Tai rare beef food photo");
  });
});

describe("unusedHits", () => {
  it("skips urls already used, duplicates, and images known to be small", () => {
    const hits = [
      { url: "https://a.example/1.jpg", title: "pho", width: 1200 },
      { url: "https://a.example/1.jpg", title: "dup", width: 1200 },
      { url: "https://a.example/2.jpg", title: "used", width: 800 },
      { url: "https://a.example/3.jpg", title: "small", width: 200 },
      { url: "https://a.example/4.jpg", title: "unknown size", width: 0 },
    ];
    expect(unusedHits(hits, ["https://a.example/2.jpg"]).map((hit) => hit.url)).toEqual(["https://a.example/1.jpg", "https://a.example/4.jpg"]);
  });
});

describe("chosenPhoto", () => {
  it("uses the vision index and treats 0 as none", () => {
    expect(chosenPhoto(2, ["a", "b", "c"])).toBe("b");
    expect(chosenPhoto(0, ["a"])).toBeNull();
    expect(chosenPhoto(4, ["a"])).toBeNull();
  });
});

describe("chooseDishPhoto", () => {
  it("skips a used url in the same result list", async () => {
    let calls = 0;
    const found = await chooseDishPhoto({
      dish: "Pho Tai",
      cuisine: "Vietnamese",
      usedUrls: ["https://img.example/old.jpg"],
      writeQuery: async () => "pho tai bowl",
      search: async () => {
        calls += 1;
        return [
          { url: "https://img.example/old.jpg", title: "old", width: 1000 },
          { url: "https://img.example/new.jpg", title: "new", width: 1000 },
        ];
      },
      download: async (url) => Buffer.from(url),
      judge: async () => 1,
    });
    expect(calls).toBe(1);
    expect(found?.sourceUrl).toBe("https://img.example/new.jpg");
  });

  it("skips a host that will not send the file", async () => {
    const found = await chooseDishPhoto({
      dish: "Pho Tai",
      cuisine: "Vietnamese",
      usedUrls: [],
      writeQuery: async () => "pho tai bowl",
      search: async () => [
        { url: "https://img.example/blocked.jpg", title: "blocked", width: 1000 },
        { url: "https://img.example/open.jpg", title: "open", width: 1000 },
      ],
      download: async (url) => (url.endsWith("blocked.jpg") ? null : Buffer.from("open")),
      judge: async () => 1,
    });
    expect(found?.sourceUrl).toBe("https://img.example/open.jpg");
  });

  it("searches with the dish name when the query writer fails, and passes over a photo vision rejects", async () => {
    const queries: string[] = [];
    let judged = 0;
    const hits = Array.from({ length: 7 }, (_, index) => ({ url: `https://img.example/${index}.jpg`, title: "pho", width: 900 }));
    const found = await chooseDishPhoto({
      dish: "Phở Tái (rare beef)",
      cuisine: null,
      usedUrls: [],
      writeQuery: async () => {
        throw new Error("nope");
      },
      search: async (query) => {
        queries.push(query);
        return hits;
      },
      download: async (url) => Buffer.from(url),
      judge: async () => {
        judged += 1;
        return judged === 1 ? 0 : 1;
      },
    });
    expect(queries).toEqual(["Pho Tai rare beef food photo"]);
    expect(found?.sourceUrl).toBe("https://img.example/6.jpg");
  });
});
