-- =====================================================================
-- Web photo URLs already used on a marketing draft. Run AFTER 16_marketing.sql.
-- Safe to re-run.
--
-- Drafts delete their JPEG when a new week is written. This table stays, so the
-- next search can skip a picture the restaurant already posted.
-- =====================================================================

create table if not exists marketing_used_photos (
  source_url  text primary key,
  dish_name   text not null,
  used_at     timestamptz not null default now()
);

create index if not exists marketing_used_photos_dish
  on marketing_used_photos (dish_name, used_at desc);

-- DEMO ONLY: anyone with the publishable key can read and write. Same as marketing_posts.
do $$
begin
  alter table marketing_used_photos enable row level security;
  if not exists (select 1 from pg_policies where tablename = 'marketing_used_photos' and policyname = 'demo full access') then
    create policy "demo full access" on marketing_used_photos for all to anon, authenticated using (true) with check (true);
  end if;
end $$;
