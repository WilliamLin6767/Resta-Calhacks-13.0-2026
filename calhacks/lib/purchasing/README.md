# Purchasing (A1)

Snap a supplier invoice: the AI reads every line, each line is matched to an ingredient, checked,
saved, and its price is added to `supplier_prices`, so `v_ingredient_unit_cost`, `v_menu_item_cost`
and the analytics pages update on their own.

**Setup:** run `supabase/04_purchasing.sql` in the Supabase SQL Editor (after 01 and 02). It only adds
columns and tables. `ANTHROPIC_API_KEY` must be in `.env.local`, same as for analytics.

**Try it:** `/invoices` → **Try the sample invoice** (`public/samples/bay-area-meat-invoice.png`, fictional).
It has a math error, a case billed but not delivered, price jumps on brisket and tendon, a cheaper
quote from Valley Butcher, and oxtail, a new ingredient. Or open invoice BAM-20633 from the sample data
and click **Check this invoice**: it finds the tendon price rise and matches the tripe line.

## How a line gets matched (`matching.ts`)

1. **Learned:** this supplier's exact text was matched before (`ingredient_aliases`, or any already-matched invoice line).
2. **Fuzzy:** shorthand expanded (`BF` → beef, `HC` → honeycomb, `PORK BUTT` → pork shoulder), sizes removed, word overlap scored.
3. **AI:** only for lines 1–2 can't settle. It picks from the closest candidates or proposes a new ingredient.

Anything unsure gets `needs_review`. Confirming it (`POST /api/invoice-lines/:id/confirm`) saves a learned match.

## Checks (`checks.ts`, pure functions, no database calls)

| kind | example |
|---|---|
| `math` | 3 × $57.20 = $171.60, but the line says $181.60 |
| `short` | billed for 2 but only 1 delivered |
| `price_up` / `price_down` | brisket up 6% vs this supplier's last price |
| `cheaper_elsewhere` | Valley Butcher charges $5.60/lb (16% less) |
| `overcharge` | billed above the linked purchase order's price |
| `duplicate`, `total_mismatch`, `unmatched` | |

`money_impact` is the dollars at stake. `BILLING_ERROR_KINDS` are the ones to dispute.

## Endpoints

| | |
|---|---|
| `POST /api/invoices/scan` (form field `file`) | photo/PDF → saved invoice, returns `{ id }` |
| `POST /api/invoices/:id/check` | match unmatched lines and re-run checks |
| `POST /api/invoice-lines/:id/confirm` | `{ ingredient_id }` or `{ new_ingredient_name, new_ingredient_unit }` |
| `POST /api/invoice-flags/:id/resolve` | mark a problem done |
| `POST /api/invoice-flags/:id/order` | cheaper-supplier flag → draft `purchase_orders` row (`created_by = 'ai'`) |

Pack sizes (`units.ts`) become `pack_qty` in the ingredient's own unit: `FISH SAUCE 6/25OZ` → 150 oz,
`HOISIN 5LB` → 80 oz, `THAI BASIL 12BU` → 12 bunches.
