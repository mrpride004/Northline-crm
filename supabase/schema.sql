-- Northline CRM — database schema
-- Run this once in Supabase: Project > SQL Editor > New query > paste all > Run

-- 1. Profiles: one row per login, linked to Supabase's built-in auth users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin','staff','dispatch')),
  created_at timestamptz default now()
);

-- 2. Products: each one gets its own order queue in the app
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- 3. Orders
create table orders (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete set null,
  customer text not null,
  phone text,
  address text,
  notes text,
  status text not null default 'New'
    check (status in ('New','Confirmed','Preparing','Dispatched','Delivered','Cancelled')),
  staff_id uuid references profiles(id) on delete set null,
  dispatch_id uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- Helper: is the current logged-in user an admin?
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer;

-- Turn on row-level security (every table locked down by default)
alter table profiles enable row level security;
alter table products enable row level security;
alter table orders enable row level security;

-- Profiles: anyone logged in can see names (needed for "assigned to" labels);
-- only admins can create/edit/delete profiles.
create policy "profiles_select_all" on profiles for select using (auth.uid() is not null);
create policy "profiles_admin_write" on profiles for insert with check (is_admin());
create policy "profiles_admin_update" on profiles for update using (is_admin());
create policy "profiles_admin_delete" on profiles for delete using (is_admin());

-- Products: anyone logged in can view; only admins manage the list.
create policy "products_select_all" on products for select using (auth.uid() is not null);
create policy "products_admin_write" on products for insert with check (is_admin());
create policy "products_admin_update" on products for update using (is_admin());
create policy "products_admin_delete" on products for delete using (is_admin());

-- Orders:
--   Admin: full access to everything.
--   Staff: can see unassigned orders (to claim) + orders assigned to them; can update those.
--   Dispatch: can see + update only orders assigned to them for delivery.
create policy "orders_select" on orders for select using (
  is_admin()
  or staff_id = auth.uid()
  or dispatch_id = auth.uid()
  or (staff_id is null and exists (select 1 from profiles where id = auth.uid() and role = 'staff'))
);

create policy "orders_admin_insert" on orders for insert with check (is_admin());

create policy "orders_update" on orders for update using (
  is_admin()
  or staff_id = auth.uid()
  or dispatch_id = auth.uid()
  or (staff_id is null and exists (select 1 from profiles where id = auth.uid() and role = 'staff'))
);

create policy "orders_admin_delete" on orders for delete using (is_admin());

-- Seed a few starter products (edit or delete these later from the app)
insert into products (name) values ('Product A'), ('Product B'), ('Product C');
