-- Trailblazer CRM — v37: a real notifications system. Every dispatch-relevant
-- (and staff/admin-relevant) event now creates a PERSISTENT database record
-- with a recipient and a read/unread state — not just a toast that vanishes
-- and a push that may or may not arrive. This is what makes notifications
-- recoverable: if someone was offline, away, or hadn't enabled push, the
-- notification is still sitting there waiting for them next time they open
-- the app, with an unread badge, exactly like the existing Messages system.
-- Run in Supabase: SQL Editor > New query > paste all > Run

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  order_id uuid references orders(id) on delete set null,
  created_at timestamptz default now(),
  read_at timestamptz
);
alter table notifications enable row level security;
drop policy if exists "notifications_select_own" on notifications;
create policy "notifications_select_own" on notifications for select using (recipient_id = auth.uid() or is_admin());
drop policy if exists "notifications_insert_any_authenticated" on notifications;
create policy "notifications_insert_any_authenticated" on notifications for insert with check (auth.uid() is not null);
drop policy if exists "notifications_update_own" on notifications;
create policy "notifications_update_own" on notifications for update using (recipient_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

create index if not exists notifications_recipient_unread_idx on notifications(recipient_id) where read_at is null;

NOTIFY pgrst, 'reload schema';
