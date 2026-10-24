import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { PostLayout } from "../marketing/copy";
import { renderPostJpeg } from "../marketing/image";

describe("renderPostJpeg", () => {
  it("writes a jpeg for each layout", async () => {
    for (const layout of ["plate", "special", "night", "boost", "boost-poster", "poll", "poll-poster"] as const satisfies readonly PostLayout[]) {
      const jpeg = await renderPostJpeg({
        layout,
        restaurant: "Pho Berkeley",
        dishName: "Pho Tai",
        headline: "Rare beef, tonight",
        subhead: "The bowl people come back for.",
      });
      expect(jpeg[0]).toBe(0xff);
      expect(jpeg[1]).toBe(0xd8);
      expect(jpeg.length).toBeGreaterThan(10_000);
    }
  }, 20000);

  it("keeps the photo in the top of the frame", async () => {
    const photo = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 210, g: 30, b: 30 } } }).jpeg().toBuffer();
    const jpeg = await renderPostJpeg(
      { layout: "plate", restaurant: "Pho Berkeley", dishName: "Pho Tai", headline: "Rare beef, tonight", subhead: "The bowl people come back for." },
      photo,
    );
    const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => (y * info.width + x) * info.channels;
    const mid = at(40, 400);
    const bottom = at(40, 1040);
    expect(data[mid]).toBeGreaterThan(180);
    expect(data[mid + 1]).toBeLessThan(80);
    expect(data[bottom]).toBeLessThan(data[mid] - 40);
  }, 20000);
});
