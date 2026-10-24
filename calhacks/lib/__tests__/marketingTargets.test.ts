import { describe, expect, it } from "vitest";
import { finishCopy } from "../marketing/copy";
import { planWeek, type MenuPerformance } from "../marketing/targets";

const menu: MenuPerformance[] = [
  { name: "Pho Tai", units: 900, units_change_pct: 4, class: "star" },
  { name: "Bun Thit Nuong", units: 120, units_change_pct: -3, class: "puzzle" },
  { name: "Cha Gio", units: 40, units_change_pct: -18, class: "dog" },
];

describe("planWeek", () => {
  it("pushes the puzzle first, then polls dishes that are not on the menu", () => {
    const slots = planWeek(menu, ["Com Ga", "Pho Tai", "Hu Tieu"]);
    expect(slots.map((slot) => slot.kind)).toEqual(["boost", "poll", "poll"]);
    expect(slots[0].dish).toBe("Bun Thit Nuong");
    expect(slots.map((slot) => slot.dish)).toEqual(["Bun Thit Nuong", "Com Ga", "Hu Tieu"]);
  });

  it("fills with another quiet dish when Trends has only one new idea", () => {
    const slots = planWeek(menu, ["Com Ga"]);
    expect(slots.map((slot) => `${slot.kind}:${slot.dish}`)).toEqual(["boost:Bun Thit Nuong", "poll:Com Ga", "boost:Cha Gio"]);
  });

  it("starts on a different dish when the week is rotated", () => {
    const slots = planWeek(menu, ["Com Ga", "Pho Tai", "Hu Tieu"], 1);
    expect(slots[0].dish).not.toBe("Bun Thit Nuong");
    expect(slots.some((slot) => slot.look === "poster")).toBe(true);
  });

  it("does not poll a dish already on the menu", () => {
    const slots = planWeek(menu, ["Pho Tai"]);
    expect(slots.every((slot) => slot.kind === "boost")).toBe(true);
  });
});

describe("finishCopy", () => {
  it("tells people how to answer a poll", () => {
    const post = finishCopy({
      layout: "poll",
      dish_name: "Com Ga",
      headline: "Add com ga?",
      subhead: "Chicken and rice, the way the neighborhood makes it.",
      caption: "We keep hearing about com ga.",
      hashtags: ["comga"],
    });
    expect(post.caption).toContain("Comment ADD");
    expect(post.hashtags).toEqual(["#comga"]);
  });
});
