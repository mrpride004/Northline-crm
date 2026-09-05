-- Northline CRM — v3 upgrade: states, agent stock, active toggle, confirmation, gift tracking
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Dispatch agents get a state, and everyone gets an active/inactive flag
alter table profiles add column if not exists state text;
alter table profiles add column if not exists active boolean not null default true;

-- 2. Orders: priority, preferred delivery time, confirmation tracking, free gift quantity
alter table orders add column if not exists priority text not null default 'Normal' check (priority in ('Normal','High'));
alter table orders add column if not exists preferred_time text;
alter table orders add column if not exists confirmed_at timestamptz;
alter table orders add column if not exists confirmed_by uuid references profiles(id);
alter table orders add column if not exists gift_quantity integer not null default 0;

-- 3. Products: link a product to a free-gift product
alter table products add column if not exists gift_product_id uuid references products(id) on delete set null;

-- 4. Agent stock: what each dispatch agent is currently holding, per product
create table if not exists agent_stock (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references profiles(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  quantity integer not null default 0,
  updated_at timestamptz default now(),
  unique(agent_id, product_id)
);

alter table agent_stock enable row level security;

create policy "agent_stock_admin_all" on agent_stock for all using (is_admin()) with check (is_admin());
create policy "agent_stock_self_select" on agent_stock for select using (agent_id = auth.uid());
