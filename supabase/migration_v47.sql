-- Trailblazer CRM — v47: Profit & Loss ("Finance") tracking.
--
-- Adds what's needed for admin to see real profitability per product/set and
-- for the company overall: cost price + packaging cost per product, and a
-- general expense ledger for waybill/freight-in, ad spend, salaries, and
-- other overhead. Delivery cost to the customer already exists as
-- orders.delivery_fee and commission cost already exists in
-- commission_ledger — both are reused rather than duplicated.
--
-- Purely additive — run in Supabase: SQL Editor > New query > paste all > Run.

-- 1. Per-unit cost fields, kept OFF the `products` table on purpose --------
-- `products` has a `select using (auth.uid() is not null)` policy, i.e.
-- every logged-in role (including staff and dispatch) can read every column
-- of it. Cost price / packaging cost are exactly the sensitive numbers this
-- feature exists to protect, so they live in their own admin-only table
-- instead of becoming columns any staff query would also pull back.

create table if not exists product_costs (
  product_id uuid primary key references products(id) on delete cascade,
  cost_price numeric(12,2) not null default 0,       -- cost to acquire one unit from the manufacturer/supplier (excludes freight-in — see expenses.category = 'waybill')
  packaging_cost numeric(12,2) not null default 0,    -- packaging cost per unit sold (box, wrap, branding, etc.)
  updated_at timestamptz not null default now()
);

alter table product_costs enable row level security;

drop policy if exists "product_costs_admin_select" on product_costs;
create policy "product_costs_admin_select" on product_costs for select using (is_admin());
drop policy if exists "product_costs_admin_insert" on product_costs;
create policy "product_costs_admin_insert" on product_costs for insert with check (is_admin());
drop policy if exists "product_costs_admin_update" on product_costs;
create policy "product_costs_admin_update" on product_costs for update using (is_admin());
drop policy if exists "product_costs_admin_delete" on product_costs;
create policy "product_costs_admin_delete" on product_costs for delete using (is_admin());

-- 2. General expense ledger ------------------------------------------------
-- One flexible table covers every non-per-order cost the admin logs by hand:
--   waybill   -> freight/shipping cost getting stock from manufacturer to
--                office or out to an agent (NOT the customer-facing delivery
--                fee, which is already tracked per order on orders.delivery_fee)
--   ad_spend  -> marketing spend by channel, optionally tied to a product/set
--   salary    -> a staff member's pay for a period
--   other     -> anything else (rent, tools, misc overhead)

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('waybill','ad_spend','salary','other')),
  channel text,                                          -- ad_spend only, e.g. "Facebook", "TikTok"
  product_id uuid references products(id) on delete set null,
  set_id uuid references product_sets(id) on delete set null,
  staff_id uuid references profiles(id) on delete set null,   -- salary only
  amount numeric(12,2) not null default 0,
  expense_date date not null default current_date,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists expenses_date_idx on expenses (expense_date);
create index if not exists expenses_category_idx on expenses (category);
create index if not exists expenses_product_idx on expenses (product_id);
create index if not exists expenses_set_idx on expenses (set_id);

alter table expenses enable row level security;

drop policy if exists "expenses_admin_select" on expenses;
create policy "expenses_admin_select" on expenses for select using (is_admin());
drop policy if exists "expenses_admin_insert" on expenses;
create policy "expenses_admin_insert" on expenses for insert with check (is_admin());
drop policy if exists "expenses_admin_update" on expenses;
create policy "expenses_admin_update" on expenses for update using (is_admin());
drop policy if exists "expenses_admin_delete" on expenses;
create policy "expenses_admin_delete" on expenses for delete using (is_admin());
