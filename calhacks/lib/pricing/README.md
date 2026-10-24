# Menu pricing (A4)

`/menu` shows what every dish costs to make today vs. 30 days ago, and suggests what to charge.
Plain math, no AI. Nothing changes until the owner clicks **Approve**.

**Setup:** run `supabase/05_pricing.sql` in the Supabase SQL Editor (after 01–03). It adds
`menu_items.delivery_price` and the `menu_price_changes` table.

## Where the numbers come from

- **Cost per serving:** recipe quantities × ingredient unit costs from `supplier_prices`, on any date
  (`unitCostsAt` in `pricing.ts`, same rule as the `v_ingredient_unit_cost` view). Every scanned invoice
  (A1) adds prices, so this stays current on its own.
- **Units sold, menu class, delivery fees:** the same `analytics_digest` the Analytics pages use.

## The rules (`pricing.ts`)

| | |
|---|---|
| Food cost above 30% of the price | suggest the price that brings it back to 30% |
| Ingredients up 3% or more | pass the increase on, so the dish earns what it did before |
| Rounding | menu-style prices: .25, .50, .75, .95 |
| More than +10% needed | suggest a first step of at most 10% |
| Dish is a "dog" or "puzzle" (sells little) | show the number but ask the owner to look first |
| Delivery apps | suggest app prices about 20% above in-house, to cover the commission |

On the seed data: Pho Tai $15.95 → $16.25, Pho Dac Biet $17.95 → $18.75, Pho Ga $15.50 → $15.75,
Bun Bo Hue $16.50 → $16.95 (brisket, bones and limes went up), plus app prices for every dish.

## Keeping menus in sync

The app can't change prices in the POS or on DoorDash / Uber Eats yet. Each approved change is logged
in `menu_price_changes` with a checkbox per system, and the page lists what's still out of date.
When a real POS or delivery integration exists, it can tick those boxes itself.

## Endpoints

| | |
|---|---|
| `POST /api/menu-items/:id/price` | `{ price, reason }`: approve a new in-house price |
| `POST /api/menu/delivery-prices` | set every too-low app price to the suggestion |
| `POST /api/price-changes/:id/updated` | `{ system: "pos" \| "doordash" \| "ubereats" }` |

Tests: `npm test` (`lib/__tests__/pricing.test.ts`).
