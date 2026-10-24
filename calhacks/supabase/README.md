# Supabase database

**This database is shared and already populated with fake demo data for "Pho Berkeley" (restaurant id 1). Nobody should run SQL that drops tables.**

Source: the exports in `/supabase/snapshot/` at the repo root (columns, functions, approximate row counts, foreign keys). The columns export was cut off at 100 rows, so columns marked † were read from the live database through the REST API instead.

## Tables and views

All purposes are **inferred** from table and column names.

| Table | Purpose (inferred) | Key columns | Links to | ~Rows |
|---|---|---|---|---|
| `restaurants` † | The restaurant itself | `id`, `name`, `cuisine`, `address`, `owner_names` | — | 1 |
| `menu_items` † | Dishes on the menu | `id`, `restaurant_id`, `name`, `category`, `price`, `delivery_price`, `active` | restaurants | 11 |
| `menu_price_changes` | History of menu price changes | unknown (table is empty, so columns couldn't be read) | restaurants, menu_items | 0 |
| `orders` † | One row per customer order | `id`, `restaurant_id`, `ordered_at`, `channel` (e.g. `dine_in`, `takeout`, `ubereats`), `subtotal`, `tax`, `tip`, `platform_fee` | restaurants | 4,939 |
| `order_items` † | Dishes within each order | `id`, `order_id`, `menu_item_id`, `qty`, `unit_price` | orders, menu_items | 8,295 |
| `ingredients` | Stock items and their levels | `id`, `restaurant_id`, `name`, `category`, `unit`, `current_qty`, `par_level`, `reorder_point`, `preferred_supplier_id`, `shelf_life_days` | restaurants, suppliers | 35 |
| `recipe_items` † | How much of each ingredient goes into a dish | `id`, `menu_item_id`, `ingredient_id`, `qty` | menu_items, ingredients | 80 |
| `ingredient_substitutes` | Ingredients that can replace each other | `id`, `ingredient_id`, `substitute_id`, `ratio`, `notes` | ingredients (twice) | 3 |
| `ingredient_aliases` | Other names for an ingredient (e.g. on supplier invoices) | `id`, `restaurant_id`, `supplier_id`, `alias`, `ingredient_id`, `source` | restaurants, suppliers, ingredients | 0 |
| `inventory_counts` | Stock counts over time | `id`, `ingredient_id`, `qty`, `source`, `counted_at`, `note` | ingredients | 70 |
| `suppliers` † | Vendors and how to order from them | `id`, `restaurant_id`, `name`, `category`, `contact_name`, `phone`, `email`, `preferred_channel`, `lead_time_days`, `min_order_amount`, `delivery_days`, `notes` | restaurants | 7 |
| `supplier_prices` † | Price history per supplier and ingredient | `id`, `supplier_id`, `ingredient_id`, `pack_desc`, `pack_qty`, `price`, `effective_date`, `source` | suppliers, ingredients | 50 |
| `purchase_orders` † | Orders sent (or drafted) to suppliers | `id`, `restaurant_id`, `supplier_id`, `status`, `created_by` (e.g. `ai`), `reason`, `expected_date`, `sent_at` | restaurants, suppliers | 3 |
| `purchase_order_lines` † | Items on a purchase order | `id`, `purchase_order_id`, `ingredient_id`, `qty`, `est_unit_price` | purchase_orders, ingredients | 5 |
| `invoices` | Supplier invoices received | `id`, `restaurant_id`, `supplier_id`, `purchase_order_id`, `invoice_number`, `invoice_date`, `due_date`, `subtotal`, `tax`, `total`, `status`, `source`, `image_url`, `paid_at` | restaurants, suppliers, purchase_orders | 8 |
| `invoice_lines` | Line items on an invoice, matched to ingredients | `id`, `invoice_id`, `ingredient_id`, `description`, `qty`, `unit_price`, `line_total`, `match_score`, `match_source`, `needs_review` | invoices, ingredients | 28 |
| `invoice_flags` | Problems found on invoices (e.g. overcharges, cheaper alternatives) | `id`, `invoice_id`, `invoice_line_id`, `ingredient_id`, `kind`, `severity`, `message`, `money_impact`, `alt_supplier_id`, `alt_unit_price`, `resolved` | invoices, invoice_lines, ingredients, suppliers | 0 |
| `expenses` | Fixed costs per period (rent, labor, etc.) | `id`, `restaurant_id`, `category`, `amount`, `period_start`, `period_end`, `note` | restaurants | 15 |
| `platform_payouts` † | Payouts from delivery apps | `id`, `restaurant_id`, `platform`, `period_start`, `period_end`, `paid_on`, `gross_sales`, `fees`, `adjustments`, `net_amount`, `reference` | restaurants | 15 |
| `market_trends` | Food trend signals (sample data) | `id`, `keyword`, `source`, `region`, `score`, `change_pct`, `observed_at` †, `note` † | — | 6 |
| `ai_insights` | Short AI-generated tips for the owner | `id`, `restaurant_id`, `kind`, `title`, `body`, `status` | restaurants | 4 |
| `ai_reports` | Saved AI reports with the digest they were built from | `id`, `restaurant_id`, `period_days`, `digest` (jsonb), `report` (jsonb), `model` | restaurants | 5 |
| `call_requests` † | Supplier phone calls an AI agent places only after the owner approves each one (from `13_calls.sql`; see `lib/calls/README.md`) | `id`, `restaurant_id`, `supplier_id`, `context_type`, `context_id`, `purpose`, `title`, `reason`, `brief` (jsonb), `status`, `proposed_by`, `wajo_call_id`, `dialed_number`, `progress`, `question`, `last_polled_at`, `outcome`, `result` (jsonb), `transcript`, `created_at`, `decided_at`, `completed_at`, `error` | restaurants, suppliers | 3 |
| `v_daily_sales` † (view) | Sales totals per day and channel | `restaurant_id`, `day`, `channel`, `order_count`, `revenue`, `platform_fees` | — | ~204 (live count) |

The other tables in the row-count export (`users`, `sessions`, `buckets`, `objects`, `migrations`, `schema_migrations` and so on) are Supabase's own auth and storage tables. Leave them alone.

## Functions

| Function | Arguments | Returns | Replaced later? |
|---|---|---|---|
| `analytics_digest` | `p_restaurant_id bigint, p_days integer DEFAULT 30` | `jsonb`: `version`, `restaurant`, `period`, `kpis.cur` / `kpis.prev`, `menu`, `costs`, `daily`, `by_hour`, `by_weekday`, `channels`, `price_changes`, `menu_thresholds`, `notes` | Yes, by prompt **06a** |
| `dish_sales_by_day` | `p_restaurant_id bigint, p_days integer DEFAULT 56` | `TABLE(day date, menu_item_id bigint, units bigint)` | No |
| `analytics_compare` | — | — | Doesn't exist yet. Prompt **08a** creates it |

## How to query

Use `getSupabase()` and `RESTAURANT_ID` from `lib/supabase.ts`, inside an async server component wrapped in `<Suspense>`:

```tsx
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

async function MenuList() {
  const supabase = await getSupabase();

  const { data: items } = await supabase
    .from("menu_items")
    .select("id, name, price")
    .eq("restaurant_id", RESTAURANT_ID);

  const { data: digest } = await supabase.rpc("analytics_digest", {
    p_restaurant_id: RESTAURANT_ID,
    p_days: 30,
  });

  return <pre>{JSON.stringify({ items, revenue: digest?.kpis?.cur?.revenue }, null, 2)}</pre>;
}
```

## Rules for new SQL

- Put new SQL in a new numbered file in `calhacks/supabase/`, e.g. `001_add_something.sql`, `002_...`.
- It may only **add** things:
  - `create table if not exists ...`
  - `alter table ... add column if not exists ...`
  - `create or replace function ...`
- It never drops tables or deletes data. No `drop table`, `truncate` or `delete from`.
