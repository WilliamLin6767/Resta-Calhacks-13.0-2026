# Prep planning (A3)

`/prep` forecasts how many of each dish will sell on a day in the next week, turns that into a prep list,
and flags what stock will run short. Plain math; the AI only adjusts the forecast when the owner writes a note.

**Setup:** run `supabase/06_prep.sql` (adds the read-only function `dish_sales_by_day`).

## How it works (`forecast.ts`)

| Step | Rule |
|---|---|
| Forecast | Weighted average of the same weekday in the last 4 weeks (weights 4, 3, 2, 1, newest first) |
| Range | Quietest and busiest of those weeks; "steady" / "varies" / "hard to call" from how much they differ |
| Closed days | A weekday with no sales in the last 8 weeks (Tuesdays in the sample data) |
| Prep list | Forecast dishes x recipe quantities |
| Stock that morning | Today's count minus the expected use of the days in between, plus open purchase orders |
| Short | Not enough for a busy day *and* not enough for an average day; these get draft orders |
| Tight | Enough for an average day, not a busy one; flagged, not ordered |

**AI (`ai.ts`):** the owner's note ("rainy, Cal game ends at 4pm") goes to Claude with the forecast. Claude
returns a factor and a reason per affected dish; factors are clamped to 0.5x-2x and shown with Undo.

**Ordering:** "Draft orders" makes one draft purchase order per supplier (preferred supplier's pack size and
price), warns if their earliest delivery is after the prep day, and they appear on `/invoices` for approval.

These rules are general restaurant knowledge, not checked with operators: weighting, ordering for a busy day.

## Endpoints

| | |
|---|---|
| `POST /api/prep/adjust` | `{ date, note }` -> `{ summary, adjustments: [{ menu_item_id, factor, reason }] }` |
| `POST /api/prep/order` | `{ date, factors }` -> `{ created: [purchase order ids] }` |
