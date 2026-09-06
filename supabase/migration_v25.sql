-- Trailblazer CRM — v25: real push notifications (Web Push).
-- Run in Supabase: SQL Editor > New query > paste all > Run

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now(),
  unique(endpoint)
);
alter table push_subscriptions enable row level security;
drop policy if exists "push_subs_own_select" on push_subscriptions;
create policy "push_subs_own_select" on push_subscriptions for select using (user_id = auth.uid() or is_admin());
drop policy if exists "push_subs_own_insert" on push_subscriptions;
create policy "push_subs_own_insert" on push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists "push_subs_own_delete" on push_subscriptions;
create policy "push_subs_own_delete" on push_subscriptions for delete using (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
