-- Northline CRM (Trailblazer) — v24: enable Realtime on orders so the app
-- can push live in-app notifications when a new order comes in or gets
-- assigned, without anyone needing to refresh.
-- Run in Supabase: SQL Editor > New query > paste all > Run

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;
end $$;

NOTIFY pgrst, 'reload schema';
