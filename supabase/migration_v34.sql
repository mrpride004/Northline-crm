-- Trailblazer CRM — v34: enable Realtime on messages so recipients get an
-- instant in-app popup the moment admin sends something, not just when they
-- next open the Messages page.
-- Run in Supabase: SQL Editor > New query > paste all > Run

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;

NOTIFY pgrst, 'reload schema';
