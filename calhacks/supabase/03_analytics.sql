-- 03_analytics.sql, version 2
--
-- analytics_digest(restaurant, days) returns ONE json object with everything the
-- Analytics page and the AI report need. The page and the AI read the same numbers.
--
-- Periods use America/Los_Angeles dates. "today" is not over yet, so it is excluded:
--   current period  = [today - days,     today)
--   previous period = [today - 2 * days, today - days)
--
-- Two kinds of food cost, on purpose:
--   1. PERIOD food cost (kpis, costs): each dish sold is costed at the ingredient
--      prices in effect ON THE ORDER DATE (preferred supplier's latest price on or
--      before that day, else the cheapest supplier's, else today's cost). So a
--      supplier price increase shows up from the day it happened.
--   2. DISH margins (menu): today's prices (v_menu_item_cost), because that is
--      what each dish earns from now on.
--
-- Fixed costs (rent, labor, ...) are the average monthly total per category,
-- prorated to the period: avg monthly * days / 30.
--
-- Safe to re-run: it replaces the function and only creates ai_reports if missing.

drop function if exists analytics_digest(bigint, int);

create function analytics_digest(p_restaurant_id bigint, p_days int default 30)
returns jsonb
language sql
stable
security invoker
as $$
with
bounds as (
  select
    t.today_local,
    t.today_local - p_days     as cur_start,
    t.today_local - 2 * p_days as prev_start
  from (select (now() at time zone 'America/Los_Angeles')::date as today_local) t
),

-- Orders in both periods, tagged 'cur' or 'prev', with local date and hour.
ord as (
  select
    o.id,
    o.channel,
    o.subtotal,
    coalesce(o.platform_fee, 0) as platform_fee,
    extract(hour from (o.ordered_at at time zone 'America/Los_Angeles'))::int as local_hour,
    (o.ordered_at at time zone 'America/Los_Angeles')::date as day,
    case when (o.ordered_at at time zone 'America/Los_Angeles')::date >= b.cur_start
         then 'cur' else 'prev' end as per
  from orders o
  cross join bounds b
  where o.restaurant_id = p_restaurant_id
    and (o.ordered_at at time zone 'America/Los_Angeles')::date >= b.prev_start
    and (o.ordered_at at time zone 'America/Los_Angeles')::date <  b.today_local
),

lines as (
  select ord.per, ord.day, oi.menu_item_id, oi.qty, oi.qty * oi.unit_price as line_revenue
  from ord
  join order_items oi on oi.order_id = ord.id
),

-- Units sold per (day, dish). Food cost is computed once per row here, not per order.
day_item as (
  select per, day, menu_item_id, sum(qty) as units
  from lines
  group by per, day, menu_item_id
),

-- Each ingredient's unit cost on each day it was needed.
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
      -- preferred supplier's latest price on or before the day
      (select sp.price / nullif(sp.pack_qty, 0)
         from supplier_prices sp
        where sp.ingredient_id = d.ingredient_id
          and sp.supplier_id = ing.preferred_supplier_id
          and sp.effective_date <= d.day
        order by sp.effective_date desc, sp.id desc
        limit 1),
      -- else the cheapest supplier's latest price on or before the day
      (select min(latest.unit_cost)
         from (select distinct on (sp.supplier_id) sp.price / nullif(sp.pack_qty, 0) as unit_cost
                 from supplier_prices sp
                where sp.ingredient_id = d.ingredient_id
                  and sp.effective_date <= d.day
                order by sp.supplier_id, sp.effective_date desc, sp.id desc) latest),
      -- else today's cost
      uc.unit_cost
    ) as unit_cost
  from day_ing d
  join ingredients ing on ing.id = d.ingredient_id
  left join v_ingredient_unit_cost uc on uc.ingredient_id = d.ingredient_id
),
day_item_cost as (
  select di.per, di.day, di.menu_item_id, di.units, sum(r.qty * dic.unit_cost) as dish_cost
  from day_item di
  join recipe_items r   on r.menu_item_id = di.menu_item_id
  join day_ing_cost dic on dic.day = di.day and dic.ingredient_id = r.ingredient_id
  group by di.per, di.day, di.menu_item_id, di.units
),
food as (
  select per, sum(units * dish_cost) as food_cost
  from day_item_cost
  group by per
),

-- Fixed costs: average monthly total per category, prorated to the period length.
monthly as (
  select e.category, date_trunc('month', e.period_start) as month, sum(e.amount) as amount
  from expenses e
  where e.restaurant_id = p_restaurant_id
  group by e.category, date_trunc('month', e.period_start)
),
fixed as (
  select category, avg(amount) * p_days / 30.0 as amount
  from monthly
  group by category
),
fixed_total as (
  select
    coalesce(sum(amount), 0)                                  as fixed_costs,
    coalesce(sum(amount) filter (where category = 'labor'), 0) as labor
  from fixed
),

-- KPIs per period. A period with no orders has no row, so it is simply missing.
per_total as (
  select per, sum(subtotal) as revenue, count(*) as orders,
         count(distinct day) as open_days, sum(platform_fee) as platform_fees
  from ord
  group by per
),
kpi as (
  select
    p.per,
    jsonb_build_object(
      'revenue',              round(p.revenue, 2),
      'orders',               p.orders,
      'open_days',            p.open_days,
      'avg_ticket',           round(p.revenue / nullif(p.orders, 0), 2),
      'revenue_per_open_day', round(p.revenue / nullif(p.open_days, 0), 2),
      'food_cost',            round(coalesce(f.food_cost, 0), 2),
      'food_cost_pct',        round(100 * coalesce(f.food_cost, 0) / nullif(p.revenue, 0), 1),
      'labor',                round(ft.labor, 2),
      'prime_cost_pct',       round(100 * (coalesce(f.food_cost, 0) + ft.labor) / nullif(p.revenue, 0), 1),
      'platform_fees',        round(p.platform_fees, 2),
      'fixed_costs',          round(ft.fixed_costs, 2),
      'est_profit',           round(p.revenue - coalesce(f.food_cost, 0) - p.platform_fees - ft.fixed_costs, 2),
      'est_profit_pct',       round(100 * (p.revenue - coalesce(f.food_cost, 0) - p.platform_fees - ft.fixed_costs)
                                    / nullif(p.revenue, 0), 1)
    ) as j
  from per_total p
  left join food f on f.per = p.per
  cross join fixed_total ft
),

-- Every day of the current period, including days with no orders.
cur_days as (
  select day, sum(subtotal) as revenue, count(*) as orders
  from ord
  where per = 'cur'
  group by day
),
daily as (
  select jsonb_agg(
           jsonb_build_object(
             'date',    g.d::date,
             'revenue', round(coalesce(cd.revenue, 0), 2),
             'orders',  coalesce(cd.orders, 0),
             'open',    cd.orders is not null)
           order by g.d) as j
  from bounds b
  cross join generate_series(b.cur_start, b.today_local - 1, interval '1 day') as g(d)
  left join cur_days cd on cd.day = g.d::date
),

-- Averages over open days only, Monday first.
by_weekday as (
  select jsonb_agg(
           jsonb_build_object(
             'weekday',     w.weekday,
             'avg_revenue', w.avg_revenue,
             'avg_orders',  w.avg_orders,
             'days',        w.days)
           order by w.iso_dow) as j
  from (
    select
      extract(isodow from day)::int as iso_dow,
      to_char(min(day), 'FMDay')    as weekday,
      round(avg(revenue), 2)        as avg_revenue,
      round(avg(orders), 1)         as avg_orders,
      count(*)                      as days
    from cur_days
    group by extract(isodow from day)
  ) w
),

-- Per local hour, divided by the current period's open days.
by_hour as (
  select jsonb_agg(
           jsonb_build_object(
             'hour',        h.local_hour,
             'avg_orders',  round(h.order_count::numeric / nullif(od.open_days, 0), 1),
             'avg_revenue', round(h.revenue / nullif(od.open_days, 0), 2))
           order by h.local_hour) as j
  from (
    select local_hour, count(*) as order_count, sum(subtotal) as revenue
    from ord
    where per = 'cur'
    group by local_hour
  ) h
  cross join (select count(*) as open_days from cur_days) od
),

-- Channels: gross revenue, platform fees and net revenue (after fees).
channel_totals as (
  select
    channel,
    count(*) filter (where per = 'cur')                    as orders,
    coalesce(sum(subtotal)     filter (where per = 'cur'), 0)  as revenue,
    coalesce(sum(platform_fee) filter (where per = 'cur'), 0)  as fees,
    coalesce(sum(subtotal)     filter (where per = 'prev'), 0) as prev_revenue,
    coalesce(sum(platform_fee) filter (where per = 'prev'), 0) as prev_fees
  from ord
  group by channel
),
channels as (
  select jsonb_agg(
           jsonb_build_object(
             'channel',                ct.channel,
             'orders',                 ct.orders,
             'revenue',                round(ct.revenue, 2),
             'revenue_share_pct',      round(100 * ct.revenue / nullif(tot.revenue, 0), 1),
             'platform_fees',          round(ct.fees, 2),
             'fee_rate_pct',           round(100 * ct.fees / nullif(ct.revenue, 0), 1),
             'net_revenue',            round(ct.revenue - ct.fees, 2),
             'prev_revenue',           round(ct.prev_revenue, 2),
             'prev_net_revenue',       round(ct.prev_revenue - ct.prev_fees, 2),
             'net_revenue_change_pct', round(100 * ((ct.revenue - ct.fees) - (ct.prev_revenue - ct.prev_fees))
                                             / nullif(abs(ct.prev_revenue - ct.prev_fees), 0), 1))
           order by ct.revenue - ct.fees desc) as j
  from channel_totals ct
  cross join (select sum(revenue) as revenue from channel_totals) tot
),

-- Menu: units in both periods, margins at today's prices.
item_totals as (
  select
    menu_item_id,
    coalesce(sum(qty)          filter (where per = 'cur'), 0)  as units,
    coalesce(sum(qty)          filter (where per = 'prev'), 0) as prev_units,
    coalesce(sum(line_revenue) filter (where per = 'cur'), 0)  as revenue
  from lines
  group by menu_item_id
),
menu_base as (
  select
    mi.name,
    mi.category,
    mi.price,
    coalesce(it.units, 0)      as units,
    coalesce(it.prev_units, 0) as prev_units,
    coalesce(it.revenue, 0)    as revenue,
    mc.food_cost               as unit_food_cost,
    mc.food_cost_pct           as food_cost_pct,
    mc.gross_margin            as unit_margin
  from menu_items mi
  left join item_totals it     on it.menu_item_id = mi.id
  left join v_menu_item_cost mc on mc.menu_item_id = mi.id
  where mi.restaurant_id = p_restaurant_id
    and mi.active
),
-- Kasavana & Smith menu engineering:
--   popular    = units >= 70% of an equal share of all units
--   profitable = unit margin >= the units-weighted average unit margin
thresholds as (
  select
    0.7 * sum(units)::numeric / nullif(count(*), 0) as popularity_threshold,
    sum(units * unit_margin) / nullif(sum(units) filter (where unit_margin is not null), 0) as margin_threshold
  from menu_base
),
menu as (
  select jsonb_agg(
           jsonb_build_object(
             'name',             mb.name,
             'category',         mb.category,
             'price',            mb.price,
             'units',            mb.units,
             'prev_units',       mb.prev_units,
             'units_change_pct', round(100 * (mb.units - mb.prev_units)::numeric / nullif(mb.prev_units, 0), 1),
             'revenue',          round(mb.revenue, 2),
             'unit_food_cost',   mb.unit_food_cost,
             'food_cost_pct',    mb.food_cost_pct,
             'unit_margin',      mb.unit_margin,
             'gross_profit',     round(mb.units * mb.unit_margin, 2),
             'class', case
                        when mb.units >= t.popularity_threshold and mb.unit_margin >= t.margin_threshold then 'star'
                        when mb.units >= t.popularity_threshold then 'plowhorse'
                        when mb.unit_margin >= t.margin_threshold then 'puzzle'
                        else 'dog'
                      end)
           order by mb.units * mb.unit_margin desc nulls last) as j
  from menu_base mb
  cross join thresholds t
),

-- How much of each ingredient the dishes sold this period used.
ingredient_usage as (
  select r.ingredient_id, sum(di.units * r.qty) as qty_used
  from day_item di
  join recipe_items r on r.menu_item_id = di.menu_item_id
  where di.per = 'cur'
  group by r.ingredient_id
),

-- Supplier price changes whose latest date falls in either period.
pc_base as (
  select
    v.supplier_id,
    v.supplier,
    v.ingredient_id,
    v.ingredient,
    v.previous_price,
    v.current_price,
    v.change_pct,
    v.latest_date,
    coalesce(ing.preferred_supplier_id = v.supplier_id, false) as is_current_supplier,
    (select sp.pack_qty from supplier_prices sp
      where sp.supplier_id = v.supplier_id and sp.ingredient_id = v.ingredient_id
        and sp.effective_date = v.previous_date
      order by sp.id desc limit 1) as prev_pack_qty,
    (select sp.pack_qty from supplier_prices sp
      where sp.supplier_id = v.supplier_id and sp.ingredient_id = v.ingredient_id
        and sp.effective_date = v.latest_date
      order by sp.id desc limit 1) as cur_pack_qty,
    uc.cheapest_unit_cost,
    uc.cheapest_supplier_id
  from v_supplier_price_changes v
  join suppliers s     on s.id = v.supplier_id
  join ingredients ing on ing.id = v.ingredient_id
  left join v_ingredient_unit_cost uc on uc.ingredient_id = v.ingredient_id
  cross join bounds b
  where s.restaurant_id = p_restaurant_id
    and v.latest_date >= b.prev_start
    and v.latest_date <  b.today_local
),
pc as (
  select
    pb.*,
    pb.current_price  / nullif(pb.cur_pack_qty, 0)  as cur_unit_cost,
    pb.previous_price / nullif(pb.prev_pack_qty, 0) as prev_unit_cost,
    (pb.cheapest_supplier_id is distinct from pb.supplier_id
       and pb.cheapest_unit_cost < pb.current_price / nullif(pb.cur_pack_qty, 0)) as other_is_cheaper
  from pc_base pb
),
price_changes as (
  select jsonb_agg(
           jsonb_build_object(
             'supplier',            pc.supplier,
             'ingredient',          pc.ingredient,
             'previous_price',      pc.previous_price,
             'current_price',       pc.current_price,
             'change_pct',          pc.change_pct,
             'since',               pc.latest_date,
             'is_current_supplier', pc.is_current_supplier,
             'dishes', coalesce(
                         (select jsonb_agg(distinct mi.name order by mi.name)
                            from recipe_items r
                            join menu_items mi on mi.id = r.menu_item_id
                           where r.ingredient_id = pc.ingredient_id),
                         '[]'::jsonb),
             'est_period_impact', case when pc.is_current_supplier
                                       then round((pc.cur_unit_cost - pc.prev_unit_cost) * coalesce(iu.qty_used, 0), 2)
                                  end,
             'cheapest_supplier',  case when pc.other_is_cheaper then cs.name end,
             'cheapest_unit_cost', case when pc.other_is_cheaper then round(pc.cheapest_unit_cost, 4) end,
             'current_unit_cost',  round(pc.cur_unit_cost, 4))
           order by pc.change_pct desc) as j
  from pc
  left join ingredient_usage iu on iu.ingredient_id = pc.ingredient_id
  left join suppliers cs        on cs.id = pc.cheapest_supplier_id
)

select jsonb_build_object(
  'version',    2,
  'restaurant', (select r.name from restaurants r where r.id = p_restaurant_id),
  'period', (
    select jsonb_build_object(
      'days',           p_days,
      'start',          b.cur_start,
      'end',            b.today_local - 1,
      'previous_start', b.prev_start,
      'previous_end',   b.cur_start - 1)
    from bounds b),
  'kpis',       coalesce((select jsonb_object_agg(per, j) from kpi), '{}'::jsonb),
  'daily',      coalesce((select j from daily), '[]'::jsonb),
  'by_weekday', coalesce((select j from by_weekday), '[]'::jsonb),
  'by_hour',    coalesce((select j from by_hour), '[]'::jsonb),
  'channels',   coalesce((select j from channels), '[]'::jsonb),
  'menu',       coalesce((select j from menu), '[]'::jsonb),
  'menu_thresholds', (
    select jsonb_build_object(
      'popularity_threshold', round(t.popularity_threshold, 1),
      'margin_threshold',     round(t.margin_threshold, 2))
    from thresholds t),
  'costs', jsonb_build_object(
    'food',          round(coalesce((select f.food_cost from food f where f.per = 'cur'), 0), 2),
    'platform_fees', round(coalesce((select p.platform_fees from per_total p where p.per = 'cur'), 0), 2),
    'fixed',         coalesce((select jsonb_object_agg(fx.category, round(fx.amount, 2)) from fixed fx), '{}'::jsonb)),
  'price_changes', coalesce((select j from price_changes), '[]'::jsonb),
  'notes', jsonb_build_array(
    'kpis.cur is this period; kpis.prev is the same-length period just before it. A missing prev means there were no orders then.',
    'Days are restaurant-local (America/Los_Angeles). Today is excluded because it is not over yet.',
    'Period food cost (kpis and costs) prices each dish at the ingredient prices in effect on the order date, so supplier price increases show up from the day they happened.',
    'Dish margins (menu) use today''s ingredient prices, because that is what each dish earns from now on.',
    'Fixed costs, including labor, are the average monthly expense per category, prorated to the period length (monthly x days / 30).',
    'Prime cost = food cost + labor, as a share of revenue.',
    'Revenue is order subtotals before tax and tips. When open days differ between periods, compare revenue_per_open_day, not total revenue.',
    'Delivery channel revenue is gross (before platform fees); net_revenue is what the restaurant keeps after fees. Judge channels by net revenue.',
    'Menu classes follow standard menu engineering: popular = units at least 70% of an equal share; profitable = unit margin at or above the units-weighted average margin. Sides, drinks and desserts are compared with mains, so a cheap side can rank low on margin and still be worth keeping.',
    'est_period_impact is only set when the supplier is the ingredient''s preferred (current) supplier: (new unit cost - old unit cost) x the amount used by dishes sold this period.',
    'cheapest_supplier is only set when a different supplier currently offers a lower unit cost.')
);
$$;

-- AI reports, saved so page loads don't call the AI.
create table if not exists ai_reports (
  id            bigint generated always as identity primary key,
  restaurant_id bigint not null references restaurants(id),
  period_days   int not null,
  digest        jsonb not null,
  report        jsonb not null,
  model         text,
  created_at    timestamptz not null default now()
);

alter table ai_reports enable row level security;

-- Demo policy: anyone with the public key can read and add reports. Fine for a demo, not for real data.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ai_reports' and policyname = 'demo read ai_reports') then
    create policy "demo read ai_reports" on ai_reports for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ai_reports' and policyname = 'demo insert ai_reports') then
    create policy "demo insert ai_reports" on ai_reports for insert with check (true);
  end if;
end
$$;
