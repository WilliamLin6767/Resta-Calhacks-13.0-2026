-- 05_compare.sql
--
-- analytics_compare(restaurant, metric, breakdown, days) returns ONE metric split by ONE
-- breakdown, for a bar chart. The Compare page and the AI assistant both use it, so every
-- chart comes from the database, never from the model.
--
-- Metrics:    revenue, net_revenue (after platform fees), orders, avg_ticket, units_sold,
--             gross_profit (revenue - food cost), food_cost_pct
-- Breakdowns: day, weekday, hour, channel, dish, category (no category -> 'Other')
--
-- Rules:
--   * orders, avg_ticket and net_revenue are per-ORDER numbers. One order holds several
--     dishes, so they can't be split by dish or category: those pairs raise an exception.
--     Unknown metrics, unknown breakdowns and days other than 7, 30, 60 raise too.
--   * Periods and food cost follow analytics_digest exactly: America/Los_Angeles dates,
--     today excluded, a previous period of the same length, and each dish costed at the
--     ingredient prices in effect on its order date.
--   * Revenue is order subtotals, except by dish or category, where it is the dish lines
--     (qty x unit price), since an order's subtotal can't be split between dishes.
--   * aggregation:
--       ratio        for avg_ticket and food_cost_pct: computed from totals, never an
--                    average of averages
--       per_open_day for weekday and hour: weekday divides by the open days of that
--                    weekday, hour divides by all open days in the period
--       total        for everything else
--   * rows: [{key, label, value, prev_value}]. day lists every date of the period (null on
--     closed days) and has no prev_value. day, weekday and hour are sorted by key; channel,
--     dish and category by value, highest first. Money has 2 decimals, counts and percents 1.

drop function if exists analytics_compare(bigint, text, text, int);

create function analytics_compare(
  p_restaurant_id bigint,
  p_metric text,
  p_breakdown text,
  p_days int default 30
)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_today       date := (now() at time zone 'America/Los_Angeles')::date;
  v_cur_start   date;
  v_prev_start  date;
  v_aggregation text;
  v_decimals    int;
  v_has_prev    boolean;
  v_rows        jsonb;
begin
  -- Validate the request.
  if p_metric is null or p_metric not in
     ('revenue', 'net_revenue', 'orders', 'avg_ticket', 'units_sold', 'gross_profit', 'food_cost_pct') then
    raise exception 'unknown metric: %', p_metric;
  end if;
  if p_breakdown is null or p_breakdown not in ('day', 'weekday', 'hour', 'channel', 'dish', 'category') then
    raise exception 'unknown breakdown: %', p_breakdown;
  end if;
  if p_days is null or p_days not in (7, 30, 60) then
    raise exception 'days must be 7, 30 or 60, got %', p_days;
  end if;
  if p_metric in ('orders', 'avg_ticket', 'net_revenue') and p_breakdown in ('dish', 'category') then
    raise exception '% cannot be broken down by %', p_metric, p_breakdown;
  end if;

  v_cur_start  := v_today - p_days;
  v_prev_start := v_today - 2 * p_days;
  v_aggregation := case
    when p_metric in ('avg_ticket', 'food_cost_pct') then 'ratio'
    when p_breakdown in ('weekday', 'hour')         then 'per_open_day'
    else 'total'
  end;
  v_decimals := case when p_metric in ('revenue', 'net_revenue', 'avg_ticket', 'gross_profit') then 2 else 1 end;

  select exists (
    select 1 from orders o
    where o.restaurant_id = p_restaurant_id
      and (o.ordered_at at time zone 'America/Los_Angeles')::date >= v_prev_start
      and (o.ordered_at at time zone 'America/Los_Angeles')::date <  v_cur_start
  ) into v_has_prev;

  with
  -- Orders in both periods, tagged 'cur' or 'prev', with local date and hour.
  ord as (
    select
      o.id,
      case when (o.ordered_at at time zone 'America/Los_Angeles')::date >= v_cur_start
           then 'cur' else 'prev' end as per,
      (o.ordered_at at time zone 'America/Los_Angeles')::date as day,
      extract(hour from (o.ordered_at at time zone 'America/Los_Angeles'))::int as hr,
      o.channel,
      o.subtotal,
      coalesce(o.platform_fee, 0) as fee
    from orders o
    where o.restaurant_id = p_restaurant_id
      and (o.ordered_at at time zone 'America/Los_Angeles')::date >= v_prev_start
      and (o.ordered_at at time zone 'America/Los_Angeles')::date <  v_today
  ),
  lines as (
    select
      ord.per, ord.day, ord.hr, ord.channel,
      oi.menu_item_id,
      mi.name as dish,
      coalesce(mi.category, 'Other') as category,
      oi.qty,
      oi.qty * oi.unit_price as line_revenue
    from ord
    join order_items oi on oi.order_id = ord.id
    join menu_items mi  on mi.id = oi.menu_item_id
  ),

  -- Food cost at the prices in effect on each order date (same rule as analytics_digest).
  day_item as (
    select distinct day, menu_item_id from lines
  ),
  day_ing as (
    select distinct di.day, r.ingredient_id
    from day_item di
    join recipe_items r on r.menu_item_id = di.menu_item_id
  ),
  day_ing_cost as (
    select
      d.day,
      d.ingredient_id,
      coalesce(
        (select sp.price / nullif(sp.pack_qty, 0)
           from supplier_prices sp
          where sp.ingredient_id = d.ingredient_id
            and sp.supplier_id = ing.preferred_supplier_id
            and sp.effective_date <= d.day
          order by sp.effective_date desc, sp.id desc
          limit 1),
        (select min(latest.unit_cost)
           from (select distinct on (sp.supplier_id) sp.price / nullif(sp.pack_qty, 0) as unit_cost
                   from supplier_prices sp
                  where sp.ingredient_id = d.ingredient_id
                    and sp.effective_date <= d.day
                  order by sp.supplier_id, sp.effective_date desc, sp.id desc) latest),
        uc.unit_cost
      ) as unit_cost
    from day_ing d
    join ingredients ing on ing.id = d.ingredient_id
    left join v_ingredient_unit_cost uc on uc.ingredient_id = d.ingredient_id
  ),
  dish_cost as (
    select di.day, di.menu_item_id, sum(r.qty * dic.unit_cost) as cost
    from day_item di
    join recipe_items r   on r.menu_item_id = di.menu_item_id
    join day_ing_cost dic on dic.day = di.day and dic.ingredient_id = r.ingredient_id
    group by di.day, di.menu_item_id
  ),
  costed as (
    select l.*, l.qty * coalesce(dc.cost, 0) as line_food
    from lines l
    left join dish_cost dc on dc.day = l.day and dc.menu_item_id = l.menu_item_id
  ),

  -- Order-level totals per bucket (not possible for dish or category).
  order_buckets as (
    select
      per,
      case p_breakdown
        when 'day'     then day::text
        when 'weekday' then extract(isodow from day)::int::text
        when 'hour'    then hr::text
        when 'channel' then channel
      end as k,
      subtotal, fee
    from ord
    where p_breakdown in ('day', 'weekday', 'hour', 'channel')
  ),
  order_agg as (
    select per, k, sum(subtotal) as rev, sum(subtotal - fee) as net, count(*) as n_orders
    from order_buckets
    group by per, k
  ),

  -- Line-level totals per bucket (works for every breakdown).
  line_buckets as (
    select
      per,
      case p_breakdown
        when 'day'      then day::text
        when 'weekday'  then extract(isodow from day)::int::text
        when 'hour'     then hr::text
        when 'channel'  then channel
        when 'dish'     then dish
        when 'category' then category
      end as k,
      qty, line_revenue, line_food
    from costed
  ),
  line_agg as (
    select per, k, sum(qty) as units, sum(line_revenue) as line_rev, sum(line_food) as food
    from line_buckets
    group by per, k
  ),

  -- Open days, for per_open_day averages.
  open_all as (
    select per, count(distinct day) as n from ord group by per
  ),
  open_weekday as (
    select per, extract(isodow from day)::int::text as k, count(distinct day) as n
    from ord
    group by per, extract(isodow from day)
  ),

  agg as (
    select
      coalesce(oa.per, la.per) as per,
      coalesce(oa.k, la.k)     as k,
      oa.rev, oa.net, oa.n_orders,
      la.units, la.line_rev, la.food,
      -- revenue for this breakdown: dish lines for dish/category, order subtotals otherwise
      case when p_breakdown in ('dish', 'category') then la.line_rev else oa.rev end as revenue
    from order_agg oa
    full join line_agg la on la.per = oa.per and la.k = oa.k
  ),
  bucket_values as (
    select
      a.per,
      a.k,
      case p_metric
        when 'revenue'       then a.revenue
        when 'net_revenue'   then a.net
        when 'orders'        then a.n_orders
        when 'avg_ticket'    then a.rev / nullif(a.n_orders, 0)
        when 'units_sold'    then a.units
        when 'gross_profit'  then a.revenue - coalesce(a.food, 0)
        when 'food_cost_pct' then 100 * coalesce(a.food, 0) / nullif(a.revenue, 0)
      end::numeric as raw
    from agg a
  ),
  final_values as (
    select
      bv.per,
      bv.k,
      case v_aggregation
        when 'per_open_day' then
          bv.raw / nullif(case when p_breakdown = 'weekday' then ow.n else oa.n end, 0)
        else bv.raw
      end as value
    from bucket_values bv
    left join open_all oa     on oa.per = bv.per
    left join open_weekday ow on ow.per = bv.per and ow.k = bv.k
  ),

  -- Which rows to show: every date for day, otherwise every bucket seen in either period.
  bucket_keys as (
    select g.d::date::text as k
    from generate_series(v_cur_start, v_today - 1, interval '1 day') as g(d)
    where p_breakdown = 'day'
    union
    select distinct fv.k from final_values fv where p_breakdown <> 'day'
  ),
  out_rows as (
    select
      bk.k,
      case
        when p_breakdown = 'day' then cur.value                      -- null on closed days
        when cur.value is not null then cur.value
        when v_aggregation = 'total' then 0                          -- nothing sold in this bucket
        when p_breakdown = 'hour' and v_aggregation = 'per_open_day'
             and (select n from open_all where per = 'cur') > 0 then 0
        else null
      end as cur_value,
      case
        when p_breakdown = 'day' or not v_has_prev then null
        when prev.value is not null then prev.value
        when v_aggregation = 'total' then 0
        when p_breakdown = 'hour' and v_aggregation = 'per_open_day' then 0
        else null
      end as prev_value
    from bucket_keys bk
    left join final_values cur  on cur.per  = 'cur'  and cur.k  = bk.k
    left join final_values prev on prev.per = 'prev' and prev.k = bk.k
  )
  select jsonb_agg(
           jsonb_build_object(
             'key', case when p_breakdown in ('weekday', 'hour') then to_jsonb(r.k::int) else to_jsonb(r.k) end,
             'label', case when p_breakdown = 'weekday'
                           then (array['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])[r.k::int]
                           else r.k end,
             'value', round(r.cur_value, v_decimals),
             'prev_value', round(r.prev_value, v_decimals))
           order by
             case when p_breakdown = 'day' then r.k::date end,
             case when p_breakdown in ('weekday', 'hour') then r.k::int end,
             case when p_breakdown in ('channel', 'dish', 'category') then r.cur_value end desc nulls last,
             r.k)
    into v_rows
  from out_rows r;

  return jsonb_build_object(
    'metric',      p_metric,
    'breakdown',   p_breakdown,
    'aggregation', v_aggregation,
    'period', jsonb_build_object(
      'days',           p_days,
      'start',          v_cur_start,
      'end',            v_today - 1,
      'previous_start', v_prev_start,
      'previous_end',   v_cur_start - 1),
    'has_previous', v_has_prev,
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;
