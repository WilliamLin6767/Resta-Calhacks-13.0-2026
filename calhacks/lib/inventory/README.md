# Inventory (A2)

`/inventory` shows what's on hand now, how many days it lasts, and what went missing. Stock changes three ways:

| | How |
|---|---|
| Deliveries | A scanned invoice (A1) is the delivery record: each matched line adds delivered packs x units per pack, once (`invoice_lines.added_to_stock`). Unsure lines wait until confirmed. |
| Counts | Photo of a shelf, a spoken or typed note, or by hand. Claude proposes counts with how sure it is; the owner checks every line before saving. |
| Waste | Spoken/typed note or by hand, with a reason; valued at the ingredient's current unit cost. |

**Setup:** run `supabase/08_inventory.sql` (after 04).

## Stock now (`stock.ts`)

On hand now = last count (with deliveries added and waste removed since) minus what sales used on the
count day and after, from recipes. Counts are assumed to happen before opening. Prep planning (A3) starts
from this number too.

A count far from that estimate (10% and at least half a unit) is logged with the gap and valued at cost:
stock that left without being recorded (unlogged waste, over-portioning, or theft).

## Counting accuracy from photos (`ai.ts`)

The hardest part of A2. What the code does about it:
- Claude is told to count only what it can see, and to count containers (cases, bags, bunches) when it can,
  which code converts with the supplier's pack size; that is more reliable than estimating loose units.
- Every line has a confidence: "Yes", "Estimate: check it", "Not sure: check it". Nothing saves without the owner.
- The photo comes with a note on what limited the count (blur, items cut off).
Photo counts haven't been measured against real shelves; treat them as a starting point, not a count.

## Endpoints

| | |
|---|---|
| `POST /api/inventory/photo` | form field `file` -> proposed counts (nothing saved) |
| `POST /api/inventory/note` | `{ text }` -> proposed counts and waste (nothing saved) |
| `POST /api/inventory/counts` | `{ items: [{ ingredient_id, qty }], source }` |
| `POST /api/inventory/waste` | `{ items: [{ ingredient_id, qty, reason }], source }` |
| `POST /api/inventory/reorder` | draft orders to bring low items back to par |
