// The two jobs Claude does for inventory (server only). Both only PROPOSE: the owner checks every
// line before anything is saved.
//   readShelfPhoto - a photo of a shelf or walk-in -> counts per ingredient, with how sure it is
//   readNote       - a spoken or typed note ("40 pounds of bones, tossed 3 lb of sprouts") -> counts and waste
import { z } from "zod";
import { AiError, ask } from "@/lib/purchasing/ai";

export type IngredientRef = { id: number; name: string; unit: string; pack_desc: string | null };

// Every field is required (unused ones come back as "" or 0), to keep the schema simple.
const CountSchema = z.object({
  ingredient_id: z.number().int(), // 0 = not on the list
  name_seen: z.string(),
  qty: z.number(),
  in_packs: z.boolean(), // true = qty is whole packs/cases as the supplier sells them
  confidence: z.number(), // 0-1
  note: z.string(),
});
const PhotoSchema = z.object({ items: z.array(CountSchema), notes: z.string() });
const NoteSchema = z.object({
  counts: z.array(CountSchema),
  waste: z.array(
    z.object({
      ingredient_id: z.number().int(),
      name_seen: z.string(),
      qty: z.number(),
      in_packs: z.boolean(),
      reason: z.enum(["spoiled", "expired", "dropped", "overcooked", "returned", "other"]),
      note: z.string(),
    }),
  ),
});
export type ProposedCount = z.infer<typeof CountSchema>;
export type ProposedWaste = z.infer<typeof NoteSchema>["waste"][number];

function ingredientList(ingredients: IngredientRef[]) {
  return ingredients.map((i) => `- id ${i.id}: ${i.name} (counted in ${i.unit}${i.pack_desc ? `; comes as ${i.pack_desc}` : ""})`).join("\n");
}

const PHOTO_SYSTEM =
  "You count stock for a small Vietnamese restaurant from a photo of a shelf, walk-in or storage area. You get the restaurant's ingredient list. " +
  "Only report what you can actually see; never guess what's hidden behind other things. Count containers when you can (cases, bags, tubs, bunches): " +
  "a closed case or bag of the size the supplier sells is in_packs=true with qty = number of packs; otherwise give qty in the ingredient's own unit (in_packs=false), estimating partial containers. " +
  "confidence: 0.9+ only for clearly visible, countable items; 0.5-0.8 for estimates (partly full, stacked, labels unreadable); below 0.5 if unsure what the item is. " +
  "ingredient_id 0 for things not on the list. note: a few words on what you saw. notes: anything that limits the count (blur, items cut off, bad light).";

const NOTE_SYSTEM =
  "You turn a restaurant worker's spoken or typed note into stock counts and waste entries. You get the restaurant's ingredient list. " +
  "Counts are what is on hand now ('we have 40 pounds of bones', 'two cases of limes'). Waste is what was thrown out ('tossed 3 lb of sprouts, slimy'). " +
  "If the quantity is in cases/bags/packs as the supplier sells them, set in_packs=true with qty = number of packs; otherwise convert to the ingredient's unit (in_packs=false). " +
  "Handle Vietnamese names and kitchen shorthand (gia = bean sprouts, rau que = Thai basil, xuong = bones, nuoc mam = fish sauce). " +
  "confidence 0.9+ when the item and amount are clear. ingredient_id 0 if it's not on the list. Leave out anything that is neither a count nor waste.";

export async function readShelfPhoto(bytes: ArrayBuffer, mediaType: string, ingredients: IngredientRef[]) {
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType)) throw new AiError("Upload a photo (JPG, PNG or WebP).", 400);
  const data = Buffer.from(bytes).toString("base64");
  return ask(
    PHOTO_SYSTEM,
    [
      { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data } },
      { type: "text", text: `Ingredient list:\n${ingredientList(ingredients)}\n\nCount what you can see.` },
    ],
    PhotoSchema,
    "medium",
  );
}

export async function readNote(text: string, ingredients: IngredientRef[]) {
  return ask(NOTE_SYSTEM, `Ingredient list:\n${ingredientList(ingredients)}\n\nNote:\n${text}`, NoteSchema, "low");
}
