import { describe, expect, it } from "vitest";
import { nameMatches } from "@/lib/purchasing/restock";

describe("nameMatches", () => {
  it("matches a spoken ingredient to the name on file", () => {
    expect(nameMatches("Beef bones", "beef bones")).toBe(true);
    expect(nameMatches("Beef bones", "beef bone")).toBe(true);
    expect(nameMatches("Eye of round (rare beef)", "brisket")).toBe(false);
  });
});
