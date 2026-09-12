-- Trailblazer CRM — v61: Security module (login history + sensitive-action log).
--
-- Two append-only tables, deliberately with no update/delete policy for
-- anyone (including admin) — an audit trail that can be edited after the
-- fact isn't one you can trust.
--
-- login_history: one row per successful sign-in, captured client-side right
-- after login via /api/log-signin (which is what can actually see the
-- request's IP address — that's not available to browser JS). Supabase
-- Auth only exposes last_sign_in_at (a single timestamp, already used
-- elsewhere in the app as "last seen") — this table is what turns that into
-- real history: every sign-in, with when, from what IP, and what
-- browser/device.
--
-- security_log: a general sensitive-action trail distinct from the
-- existing `audit_log` table (which is specifically for order
-- corrections/confirmations — see migration_v18 era). This one covers
-- account-level actions: password resets, role/permission changes, login
-- creation/removal, account activation toggles.

create table if not exists login_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  actor_name text,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);
create index if not exists idx_login_history_user_id on login_history(user_id);
alter table login_history enable row level security;
create policy login_history_select on login_history for select using (is_admin() or user_id = auth.uid());
create policy login_history_insert on login_history for insert with check (user_id = auth.uid());

create table if not exists security_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  actor_name text,
  action text not null,
  target_type text,
  target_id uuid,
  target_name text,
  details text,
  created_at timestamptz default now()
);
create index if not exists idx_security_log_created_at on security_log(created_at desc);
alter table security_log enable row level security;
create policy security_log_select on security_log for select using (is_admin());
create policy security_log_insert on security_log for insert with check (actor_id = auth.uid());
