-- 0007_readonly_role.sql — restricted role backing /api/query (text-to-SQL safety)
-- Defense-in-depth: even if a hostile generated query slips past the SQL guard,
-- this role physically cannot mutate data.
--
-- This migration creates crate_readonly as a NOLOGIN group with SELECT-only
-- grants (no password in source control). To actually connect as it, run ONCE
-- (out of band, with your own secret — see supabase/README.md):
--
--     alter role crate_readonly with login password '<strong-password>';
--
-- then put that into SUPABASE_DB_URL_READONLY.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crate_readonly') then
    create role crate_readonly nologin;
  end if;
end$$;

-- schema usage + read on everything that already exists
grant usage on schema public to crate_readonly;
grant select on all tables in schema public to crate_readonly;

-- materialized views are not covered by "ALL TABLES" on every PG version — grant explicitly
grant select on mv_artist_counts, mv_producer_counts, mv_label_counts,
                mv_genre_distribution, mv_decade_distribution, mv_country_distribution,
                mv_save_timeline, mv_playlist_presence, v_orphans
  to crate_readonly;

-- future tables created in the public schema are readable too
alter default privileges in schema public grant select on tables to crate_readonly;

-- belt-and-suspenders: ensure NO write privileges anywhere
revoke insert, update, delete, truncate on all tables in schema public from crate_readonly;
revoke all on schema public from crate_readonly;
grant usage on schema public to crate_readonly;   -- re-grant the usage we just revoked
