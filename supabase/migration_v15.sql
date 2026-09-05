-- Northline CRM — v15: commission system for staff.
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Commission rules, one per product
create table if not exists commission_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  standard_type text not null default 'fixed' check (standard_type in ('fixed','percentage')),
  standard_value numeric(12,2) not null default 0,
  upsell_type text not null default 'fixed' check (upsell_type in ('fixed','percentage')),
  upsell_value numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz default now(),
  unique(product_id)
);
alter table commission_rules enable row level security;
drop policy if exists "commission_rules_select_all" on commission_rules;
create policy "commission_rules_select_all" on commission_rules for select using (auth.uid() is not null);
drop policy if exists "commission_rules_admin_write" on commission_rules;
create policy "commission_rules_admin_write" on commission_rules for insert with check (is_admin());
drop policy if exists "commission_rules_admin_update" on commission_rules;
create policy "commission_rules_admin_update" on commission_rules for update using (is_admin());
drop policy if exists "commission_rules_admin_delete" on commission_rules;
create policy "commission_rules_admin_delete" on commission_rules for delete using (is_admin());

-- 2. Ledger: one row per commission-earning event, auto-created when an order is marked Paid
create table if not exists commission_ledger (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  staff_id uuid references profiles(id) on delete cascade,
  product_id uuid references products(id),
  amount numeric(12,2) not null,
  commission_type text not null check (commission_type in ('standard','upsell')),
  cycle_start date not null,
  reversed boolean not null default false,
  created_at timestamptz default now()
);
alter table commission_ledger enable row level security;
drop policy if exists "commission_ledger_select" on commission_ledger;
create policy "commission_ledger_select" on commission_ledger for select using (is_admin() or staff_id = auth.uid());
drop policy if exists "commission_ledger_insert" on commission_ledger;
create policy "commission_ledger_insert" on commission_ledger for insert with check (auth.uid() is not null);
drop policy if exists "commission_ledger_update" on commission_ledger;
create policy "commission_ledger_update" on commission_ledger for update using (auth.uid() is not null);

-- 3. Claims: a record every time a staff member cashes out their unclaimed balance
create table if not exists commission_claims (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references profiles(id) on delete cascade,
  amount numeric(12,2) not null,
  claimed_at timestamptz default now()
);
alter table commission_claims enable row level security;
drop policy if exists "commission_claims_select" on commission_claims;
create policy "commission_claims_select" on commission_claims for select using (is_admin() or staff_id = auth.uid());
drop policy if exists "commission_claims_insert" on commission_claims;
create policy "commission_claims_insert" on commission_claims for insert with check (staff_id = auth.uid() or is_admin());

-- 4. Global setting: minimum delivery-success rate required to claim (percentage, e.g. 80)
insert into app_settings (key, value) values ('min_success_rate_to_claim', '0') on conflict (key) do nothing;

NOTIFY pgrst, 'reload schema';
