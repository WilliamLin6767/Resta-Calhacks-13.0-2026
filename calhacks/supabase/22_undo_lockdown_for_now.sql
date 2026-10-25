-- =====================================================================
-- Undo 17_lockdown.sql on the Resta project, for now. Safe to re-run.
--
-- Why: the live site (Vercel) and teammates running the main branch still use the public anon
-- key, so after 17 they get "permission denied". This puts the public key's access back the way
-- it was before 17 (the "demo full access" policies), until the new code is deployed with
-- SUPABASE_SECRET_KEY on Vercel and every teammate has it in .env.local. Then run 17 again.
--
-- The two new tables, agent_actions and cases, stay server only (the old code never used them).
-- =====================================================================

-- 1. Grants for the public roles, now and for new tables
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to public;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to public;

-- 2. Every table 17 locked gets its "demo full access" policy back (what the old SQL files gave
--    them), except the new server-only tables
do $$
declare
  t record;
begin
  for t in
    select tablename from pg_policies
    where schemaname = 'public' and policyname = 'server only' and tablename not in ('agent_actions', 'cases')
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tablename and policyname = 'demo full access') then
      execute format('create policy "demo full access" on public.%I for all to anon, authenticated using (true) with check (true)', t.tablename);
    end if;
  end loop;
end $$;

-- 3. The new tables stay closed to the public key
do $$
begin
  if to_regclass('public.agent_actions') is not null then
    revoke all on public.agent_actions from anon, authenticated;
  end if;
  if to_regclass('public.cases') is not null then
    revoke all on public.cases from anon, authenticated;
  end if;
end $$;

-- 4. Marketing photos: the old app uploads with the public key too
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'marketing demo access') then
    create policy "marketing demo access" on storage.objects
      for all to anon, authenticated
      using (bucket_id = 'marketing')
      with check (bucket_id = 'marketing');
  end if;
end $$;
