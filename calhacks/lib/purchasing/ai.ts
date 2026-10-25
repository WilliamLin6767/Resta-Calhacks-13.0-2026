// The two jobs Claude does for purchasing (server only):
//   readInvoice  - a photo or PDF of a supplier invoice -> structured lines
//   matchLines   - settle the invoice lines our own matcher wasn't sure about
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// Change this one line to try a different Claude model.
const MODEL = "claude-opus-5-5";

// Reads ANTHROPIC_API_KEY from the environment. Runs on the server only.
const anthropic = new Anthropic();

export class AiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Every field is required (unused ones come back as "" or 0): keeps the schema simple enough for structured outputs.
const InvoiceLineSchema = z.object({
  description: z.string(), // exactly as printed, e.g. "BF BRISKET 15#"
  item_code: z.string(),
  pack: z.string(), // pack size as printed, e.g. "15#", "6/25OZ", "12BU"
  sold_by: z.string(), // CS, LB, EA, BG ...
  qty_ordered: z.number(),
  qty_shipped: z.number(),
  unit_price: z.number(),
  line_total: z.number(),
});
export const InvoiceSchema = z.object({
  supplier_name: z.string(),
  invoice_number: z.string(),
  invoice_date: z.string(), // YYYY-MM-DD
  due_date: z.string(),
  lines: z.array(InvoiceLineSchema),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  notes: z.string(),
});
export type ReadInvoice = z.infer<typeof InvoiceSchema>;

const READ_SYSTEM =
  "You read supplier invoices for a restaurant and copy them into structured data. Copy what is printed; never invent or correct numbers. If a value isn't printed, use an empty string for text and 0 for numbers.\n\n" +
  "For each product line: description exactly as printed (keep abbreviations like BF BRISKET); item_code if printed; " +
  "pack = the pack size as printed (e.g. 15#, 6/25OZ, 12BU, 200CT), or empty; sold_by = what the line is sold by as printed (CS, LB, EA, BG...; CS if per case but unlabeled); " +
  "qty_ordered and qty_shipped: copy both if there are separate ordered and shipped columns, otherwise put the one quantity in both; " +
  "unit_price and line_total exactly as printed. Skip non-product lines unless they carry a charge. Dates as YYYY-MM-DD. " +
  "notes: anything a buyer should know (handwritten changes, out of stock, credits).";

const MatchSchema = z.object({
  matches: z.array(
    z.object({
      line: z.number().int(),
      ingredient_id: z.number().int(), // 0 = none of the candidates
      confidence: z.number(),
      new_ingredient_name: z.string(),
      new_ingredient_category: z.string(),
      new_ingredient_unit: z.enum(["lb", "oz", "ea", "bunch", "can", "head"]),
      reason: z.string(),
    }),
  ),
});
export type AiMatch = z.infer<typeof MatchSchema>["matches"][number];

const MATCH_SYSTEM =
  "You match lines from a Vietnamese restaurant's supplier invoices to the restaurant's own ingredient list. For each line you get the printed text and the closest candidates. " +
  "Pick the candidate that is the SAME product (same cut, form and type: brisket is not eye of round; rice vermicelli is not broken rice). " +
  "Vietnamese and butcher shorthand is common (BUN = rice vermicelli, BANH PHO = pho rice noodles, HC = honeycomb). " +
  "If none is the same product, set ingredient_id to 0 and suggest new_ingredient_name (plain words), new_ingredient_category " +
  "(protein, noodles & rice, produce, sauces & spices, dry goods, bakery, beverage) and new_ingredient_unit. confidence 0-1. reason: a few words.";

// One structured-output call to Claude, with readable errors. Also used by prep planning (lib/prep/ai.ts).
export async function ask<T extends z.ZodType>(system: string, content: Anthropic.Beta.Messages.BetaContentBlockParam[] | string, schema: T, effort: "low" | "medium"): Promise<z.infer<T>> {
  let response;
  try {
    response = await anthropic.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content }],
      output_config: { effort, format: betaZodOutputFormat(schema) },
      // If the model declines the request, the API retries it on a recommended fallback model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    // Most specific error types first.
    if (err instanceof Anthropic.AuthenticationError) throw new AiError("The Anthropic API key is missing or invalid.", 500);
    if (err instanceof Anthropic.RateLimitError) throw new AiError("Too many AI requests right now. Try again in a minute.", 429);
    if (err instanceof Anthropic.BadRequestError) throw new AiError(`The AI request was rejected: ${err.message}`, 500);
    if (err instanceof Anthropic.APIConnectionError) throw new AiError("Could not reach the AI service. Check your connection.", 502);
    if (err instanceof Anthropic.APIError) throw new AiError(`AI service error (${err.status}): ${err.message}`, 502);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new AiError("The AI declined to read this file.", 502);
  if (response.stop_reason === "max_tokens") throw new AiError("The AI's answer was cut off. Try again.", 502);
  if (!response.parsed_output) throw new AiError("The AI's answer was not in the expected format.", 502);
  return response.parsed_output as z.infer<T>;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

// file bytes -> the invoice as printed
export async function readInvoice(bytes: ArrayBuffer, mediaType: string): Promise<ReadInvoice> {
  const data = Buffer.from(bytes).toString("base64");
  let block: Anthropic.Beta.Messages.BetaContentBlockParam;
  if (mediaType === "application/pdf") {
    block = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  } else if ((IMAGE_TYPES as readonly string[]).includes(mediaType)) {
    block = { type: "image", source: { type: "base64", media_type: mediaType as (typeof IMAGE_TYPES)[number], data } };
  } else {
    throw new AiError("Upload a photo (JPG, PNG, WebP) or a PDF of the invoice.", 400);
  }
  return ask(READ_SYSTEM, [block, { type: "text", text: "Copy this invoice into the structured format." }], InvoiceSchema, "medium");
}

// The same, for an invoice written out in an email's text instead of attached
export async function readInvoiceText(text: string): Promise<ReadInvoice> {
  return ask(READ_SYSTEM, `This invoice came as the text of an email. Copy it into the structured format.\n\n${text}`, InvoiceSchema, "medium");
}

// Lines our matcher wasn't sure about -> Claude's pick for each (keyed by line number)
export async function matchLines(
  lines: { line: number; description: string; pack: string; candidates: { ingredient_id: number; name: string }[] }[],
): Promise<Map<number, AiMatch>> {
  if (!lines.length) return new Map();
  const result = await ask(MATCH_SYSTEM, "Lines to match:\n" + JSON.stringify(lines, null, 1), MatchSchema, "low");
  return new Map(result.matches.map((m) => [m.line, m]));
}
