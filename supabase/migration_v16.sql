-- Northline CRM — v16: separate on/off switches for standard vs upsell
-- commission, a new "free commission" (flat, performance-independent) rule
-- set, and per-rule staff eligibility.
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Split the single "active" flag into two independent switches, add eligibility
alter table commission_rules add column if not exists standard_active boolean not null default true;
alter table commission_rules add column if not exists upsell_active boolean not null default true;
alter table commission_rules add column if not exists eligible_staff uuid[];

-- 2. Allow a third commission type: "free" (flat, not tied to any product/order performance)
alter table commission_ledger drop constraint if exists commission_ledger_commission_type_check;
alter table commission_ledger add constraint commission_ledger_commission_type_check
  check (commission_type in ('standard','upsell','free'));

-- 3. Free commission rule — one flat amount per cycle, admin turns on/off and picks who qualifies
create table if not exists free_commission_rules (
  id uuid primary key default gen_random_uuid(),
  amount numeric(12,2) not null default 0,
  active boolean not null default false,
  eligible_staff uuid[],
  created_at timestamptz default now()
);
alter table free_commission_rules enable row level security;
drop policy if exists "free_commission_rules_select_all" on free_commission_rules;
create policy "free_commission_rules_select_all" on free_commission_rules for select using (auth.uid() is not null);
drop policy if exists "free_commission_rules_admin_write" on free_commission_rules;
create policy "free_commission_rules_admin_write" on free_commission_rules for insert with check (is_admin());
drop policy if exists "free_commission_rules_admin_update" on free_commission_rules;
create policy "free_commission_rules_admin_update" on free_commission_rules for update using (is_admin());

NOTIFY pgrst, 'reload schema';
