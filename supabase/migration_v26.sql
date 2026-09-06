-- Trailblazer CRM — v26: rolling success-rate window (per-staff toggle) and
-- load-balancing auto-assign across multiple dispatch agents in a state.
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Per-staff toggle for whether their success rate uses a rolling window
alter table profiles add column if not exists success_rate_window_enabled boolean not null default false;

-- 2. Global setting: how many days the rolling window covers
insert into app_settings (key, value) values ('success_rate_window_days', '30') on conflict (key) do nothing;

-- 3. Let state_dispatch_preference support a load-balancing mode instead of
-- (or alongside) a single fixed preferred agent.
alter table state_dispatch_preference add column if not exists assignment_mode text not null default 'preferred' check (assignment_mode in ('preferred', 'round_robin'));

NOTIFY pgrst, 'reload schema';
