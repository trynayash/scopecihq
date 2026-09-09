-- Run once in the Supabase SQL editor, after `pnpm --filter @workspace/db run push`.
--
-- Supabase serves every table in the `public` schema through PostgREST using the
-- anon key, and that key is designed to ship in client code. Tables created by
-- drizzle-kit have row level security DISABLED, so without this the entire
-- waitlist — every email address — is readable by anyone who finds the key.

alter table public.waitlist_signups enable row level security;

-- No policies are created, so PostgREST denies anon and authenticated requests
-- outright. The API server connects over the Postgres protocol as the table
-- owner, which bypasses RLS, so inserts from the site keep working.
revoke all on table public.waitlist_signups from anon, authenticated;
revoke all on sequence public.waitlist_signups_id_seq from anon, authenticated;

-- Newest-first is how the list gets read, in the dashboard and in exports.
create index if not exists waitlist_signups_created_at_idx
  on public.waitlist_signups (created_at desc);
