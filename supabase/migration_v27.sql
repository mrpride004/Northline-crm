-- Trailblazer CRM — v27: persistent messages, so an admin broadcast isn't just
-- a fleeting push notification — recipients can see it later in a Messages inbox.
-- Run in Supabase: SQL Editor > New query > paste all > Run

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references profiles(id),
  sender_name text,
  recipient_id uuid references profiles(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz default now()
);
alter table messages enable row level security;
drop policy if exists "messages_select_own" on messages;
create policy "messages_select_own" on messages for select using (recipient_id = auth.uid() or is_admin());
drop policy if exists "messages_admin_insert" on messages;
create policy "messages_admin_insert" on messages for insert with check (is_admin());
drop policy if exists "messages_recipient_update" on messages;
create policy "messages_recipient_update" on messages for update using (recipient_id = auth.uid());

NOTIFY pgrst, 'reload schema';
