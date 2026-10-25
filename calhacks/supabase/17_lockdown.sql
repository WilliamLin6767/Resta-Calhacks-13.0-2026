-- =====================================================================
-- Lockdown: the public (anon) key can no longer read or write anything. Run AFTER 16.
-- Safe to re-run. Run it only once the app works with SUPABASE_SECRET_KEY in .env.local:
-- after this, the anon key gets "permission denied" everywhere.
--
-- The app's server uses the secret key, which belongs to the service_role and bypasses row
-- level security, so every page and route keeps working. The browser never talks to Supabase.
--
-- What it changes (no table is dropped or rewritten, and no row is touched):
--   1. Every policy in the public schema that let anon, authenticated or everyone in (the
--      "demo full access" ones, the ai_reports demo policies, and any added by hand to the
--      seed tables) is replaced by one "server only" policy for the service_role.
--   2. Row level security is turned on for every table in public (the seed tables included).
--   3. anon and authenticated lose their grants on tables, views, sequences and functions
--      (analytics_digest and the other read functions too), now and for future objects.
--      authenticated matters because anyone could sign up through Supabase Auth with the
--      public key and get that role.
--   4. The marketing photo bucket stays readable by anyone (Buffer fetches the JPEG from its
--      public URL); only the server can upload or delete.
-- =====================================================================

do $$
declare
  p record;
  t record;
begin
  -- 1. Drop every policy that applies to anon, authenticated or public (everyone)
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles && array['anon', 'authenticated', 'public']::name[]
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;

  -- 2. Row level security on every table, and one policy that names who may use it
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tablename and policyname = 'server only') then
      execute format('create policy "server only" on public.%I for all to service_role using (true) with check (true)', t.tablename);
    end if;
  end loop;
end $$;

-- 3. No grants for the public roles, now or for tables and functions added later
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- The server's role keeps everything it had
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- 4. Marketing photos: anyone can read them, only the server can write
drop policy if exists "marketing demo access" on storage.objects;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'marketing public read'
  ) then
    create policy "marketing public read" on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'marketing');
  end if;
end $$;

-- Check: this should list no policy for anon, authenticated or public in the public schema
-- select tablename, policyname, roles from pg_policies where schemaname = 'public' order by 1;
