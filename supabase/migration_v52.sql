-- Trailblazer CRM — v52: a real "last seen" for admin, based on actual
-- activity instead of auth sign-in events.
--
-- Context: the existing "last seen" (Team page, person detail) was reading
-- Supabase Auth's last_sign_in_at, which only updates when someone actually
-- goes through a fresh login — not on every day they use the app while
-- staying signed in. That made it look stale/frozen for admin, even for
-- staff actively working in the CRM right now.
--
-- Fix: a tiny presence table the logged-in client "pings" every few minutes
-- (and whenever the tab becomes visible again) via a security-definer RPC,
-- so every role always writes only their own row regardless of the
-- profiles table's admin-only UPDATE policy. This is deliberately its own
-- table (not a column on `profiles`) so frequent heartbeat writes never
-- trigger the app's "profiles changed, everyone refetch everything"
-- realtime listener — that would otherwise turn a cheap presence ping into
-- a full-app refresh storm across every connected session.
--
-- Already applied directly to production via the Supabase MCP connection.
-- Kept here as the source-of-truth record of the schema change.

create table if not exists user_presence (
  user_id uuid primary key references profiles(id) on delete cascade,
  last_active_at timestamptz not null default now()
);

alter table user_presence enable row level security;

drop policy if exists user_presence_select_admin on user_presence;
create policy user_presence_select_admin on user_presence for select using (is_admin());

drop policy if exists user_presence_select_self on user_presence;
create policy user_presence_select_self on user_presence for select using (user_id = auth.uid());

-- SECURITY DEFINER so it can upsert regardless of the (intentionally admin-only)
-- write policy on profiles-adjacent tables — it only ever touches the
-- caller's own row (auth.uid()), never an arbitrary one.
create or replace function touch_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into user_presence (user_id, last_active_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_active_at = excluded.last_active_at;
end;
$$;

grant execute on function touch_presence() to authenticated;
