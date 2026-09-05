-- Northline CRM — v17: second phone number, last-status-update timestamp,
-- and admin-set preferred dispatch agent per state.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table orders add column if not exists phone2 text;
alter table orders add column if not exists status_updated_at timestamptz default now();

create table if not exists state_dispatch_preference (
  state text primary key,
  dispatch_id uuid references profiles(id) on delete set null,
  active boolean not null default true,
  updated_at timestamptz default now()
);
alter table state_dispatch_preference enable row level security;
drop policy if exists "state_dispatch_pref_select_all" on state_dispatch_preference;
create policy "state_dispatch_pref_select_all" on state_dispatch_preference for select using (auth.uid() is not null);
drop policy if exists "state_dispatch_pref_admin_write" on state_dispatch_preference;
create policy "state_dispatch_pref_admin_write" on state_dispatch_preference for insert with check (is_admin());
drop policy if exists "state_dispatch_pref_admin_update" on state_dispatch_preference;
create policy "state_dispatch_pref_admin_update" on state_dispatch_preference for update using (is_admin());

NOTIFY pgrst, 'reload schema';
