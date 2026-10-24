-- =====================================================================
-- Prep planning (A3): dishes sold per day, for the sales forecast.
-- Run AFTER 01_schema.sql and 02_seed.sql. Safe to re-run.
--
--   select * from dish_sales_by_day(1, 56);   -- restaurant 1, last 8 weeks
--
-- Adds one read-only function and changes nothing else. It adds up order
-- lines in the database, because 8 weeks of order lines is more rows than
-- one request returns.
-- =====================================================================

create or replace function dish_sales_by_day(p_restaurant_id bigint, p_days int default 56)
returns table (day date, menu_item_id bigint, units bigint)
language sql
stable
security invoker
as $$
  select (o.ordered_at at time zone 'America/Los_Angeles')::date as day,
         oi.menu_item_id,
         sum(oi.qty)::bigint as units
  from orders o
  join order_items oi on oi.order_id = o.id
  where o.restaurant_id = p_restaurant_id
    and (o.ordered_at at time zone 'America/Los_Angeles')::date >= (now() at time zone 'America/Los_Angeles')::date - p_days
    and (o.ordered_at at time zone 'America/Los_Angeles')::date <  (now() at time zone 'America/Los_Angeles')::date
  group by 1, 2
  order by 1, 2
$$;
