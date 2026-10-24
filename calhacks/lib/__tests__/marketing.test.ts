import { describe, expect, it } from "vitest";
import { assignDishes, captionFor, cleanHashtags, pickDish, shapeDrafts } from "../marketing/copy";
import { parseHashtags, readPostEdit } from "../marketing/edit";
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
