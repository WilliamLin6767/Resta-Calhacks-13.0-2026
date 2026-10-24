// The one job Claude does for sales receipts (server only): a photo of a customer receipt ->
// its lines, each matched to a dish on the menu. It only proposes: the owner checks before saving.
import { z } from "zod";
import { AiError, ask } from "@/lib/purchasing/ai";
import type { MenuRef } from "./receipt";

// Every field is required (unused ones come back as "" or 0), to keep the schema simple.
const ReceiptSchema = z.object({
  receipt_number: z.string(),
  date: z.string(), // YYYY-MM-DD
  time: z.string(), // HH:MM, 24-hour
  channel: z.enum(["dine_in", "takeout", "unknown"]),
  lines: z.array(
    z.object({
      printed: z.string(), // exactly as printed, e.g. "PHO DB (HOUSE SP)"
      qty: z.number(),
      unit_price: z.number(),
      line_total: z.number(),
      menu_item_id: z.number().int(), // 0 = not on the menu
      confidence: z.number(), // 0-1
    }),
  ),
  subtotal: z.number(),
  tax: z.number(),
  tip: z.number(),
  total: z.number(),
});
export type ReadReceipt = z.infer<typeof ReceiptSchema>;

const SYSTEM =
  "You read customer receipts from a Vietnamese restaurant and copy them into structured data. Copy what is printed; never invent or correct numbers. " +
  "If a value isn't printed, use an empty string for text and 0 for numbers. Dates as YYYY-MM-DD, time as 24-hour HH:MM. " +
  "For each item line: printed = the text exactly as printed; qty; unit_price (if only the line total is printed, divide it by qty); line_total as printed. " +
  "Skip lines that aren't dishes or drinks (subtotal, tax, tip, payment, modifiers with no price). " +
  "Match each line to the restaurant's menu by id. POS shorthand is common: DB = Dac Biet (house special), CF or CA PHE = Ca Phe, SUA DA = iced milk coffee, 4PC/2PC = piece counts. " +
  "Use menu_item_id 0 if no menu item is the same dish. confidence 0.9+ only when the match is clear. channel: dine_in, takeout (to go, pickup), or unknown.";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function readReceipt(bytes: ArrayBuffer, mediaType: string, menu: MenuRef[]): Promise<ReadReceipt> {
  if (!IMAGE_TYPES.includes(mediaType)) throw new AiError("Upload a photo of the receipt (JPG, PNG or WebP).", 400);
  const data = Buffer.from(bytes).toString("base64");
  const result = await ask(
    SYSTEM,
    [
      { type: "image", source: { type: "base64", media_type: mediaType as "image/png", data } },
      { type: "text", text: `Menu:\n${menu.map((m) => `- id ${m.id}: ${m.name}, $${m.price.toFixed(2)}`).join("\n")}\n\nCopy this receipt.` },
    ],
    ReceiptSchema,
    "medium",
  );
  const ids = new Set(menu.map((m) => m.id));
  return { ...result, lines: result.lines.map((l) => (ids.has(l.menu_item_id) ? l : { ...l, menu_item_id: 0 })) };
}
