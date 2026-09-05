-- Northline CRM — v9 safety net. Re-asserts every column, table, and policy
-- from migrations v2 through v8 using "if not exists" everywhere, so it's
-- safe to run even if earlier migrations partially failed.
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- Orders: order details
alter table orders add column if not exists quantity integer not null default 1;
alter table orders add column if not exists unit_price numeric(12,2);
alter table orders add column if not exists delivery_fee numeric(12,2) not null default 0;
alter table orders add column if not exists payment_status text not null default 'Unpaid';
alter table orders add column if not exists reschedule_date date;
alter table orders add column if not exists delivered_at timestamptz;
alter table orders add column if not exists priority text not null default 'Normal';
alter table orders add column if not exists preferred_time text;
alter table orders add column if not exists confirmed_at timestamptz;
alter table orders add column if not exists confirmed_by uuid references profiles(id);
alter table orders add column if not exists gift_quantity integer not null default 0;
alter table orders add column if not exists state text;
alter table orders add column if not exists package_id uuid;
alter table orders add column if not exists created_by uuid references profiles(id);
alter table orders add column if not exists forwarded_to uuid;

-- Products: stock + gift linking (legacy) + packages
alter table products add column if not exists stock_quantity integer not null default 0;
alter table products add column if not exists low_stock_threshold integer not null default 5;
alter table products add column if not exists gift_product_id uuid references products(id) on delete set null;

-- Profiles: state, active, permissions, username
alter table profiles add column if not exists state text;
alter table profiles add column if not exists active boolean not null default true;
alter table profiles add column if not exists allowed_products uuid[];
alter table profiles add column if not exists username text unique;

-- Agent stock
create table if not exists agent_stock (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references profiles(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  quantity integer not null default 0,
  updated_at timestamptz default now(),
  unique(agent_id, product_id)
);
alter table agent_stock enable row level security;
drop policy if exists "agent_stock_admin_all" on agent_stock;
create policy "agent_stock_admin_all" on agent_stock for all using (is_admin()) with check (is_admin());
drop policy if exists "agent_stock_self_select" on agent_stock;
create policy "agent_stock_self_select" on agent_stock for select using (agent_id = auth.uid());

-- Order events (history/remarks/notifications)
create table if not exists order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz default now()
);
alter table order_events enable row level security;
drop policy if exists "order_events_select" on order_events;
create policy "order_events_select" on order_events for select using (
  is_admin()
  or exists (select 1 from orders o where o.id = order_events.order_id
    and (o.staff_id = auth.uid() or o.dispatch_id = auth.uid() or o.staff_id is null))
);
drop policy if exists "order_events_insert" on order_events;
create policy "order_events_insert" on order_events for insert with check (
  is_admin()
  or exists (select 1 from orders o where o.id = order_events.order_id
    and (o.staff_id = auth.uid() or o.dispatch_id = auth.uid() or o.created_by = auth.uid()))
);

-- App settings
create table if not exists app_settings (
  key text primary key,
  value text
);
alter table app_settings enable row level security;
drop policy if exists "app_settings_admin_all" on app_settings;
create policy "app_settings_admin_all" on app_settings for all using (is_admin()) with check (is_admin());
drop policy if exists "app_settings_select_all" on app_settings;
create policy "app_settings_select_all" on app_settings for select using (auth.uid() is not null);
insert into app_settings (key, value) values
  ('sms_auto_confirm', 'false'), ('whatsapp_auto_confirm', 'false')
on conflict (key) do nothing;

-- Dispatch companies
create table if not exists dispatch_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text not null,
  channel text not null default 'whatsapp',
  active boolean not null default true,
  created_at timestamptz default now()
);
alter table dispatch_companies enable row level security;
drop policy if exists "dispatch_companies_admin_all" on dispatch_companies;
create policy "dispatch_companies_admin_all" on dispatch_companies for all using (is_admin()) with check (is_admin());
drop policy if exists "dispatch_companies_select_all" on dispatch_companies;
create policy "dispatch_companies_select_all" on dispatch_companies for select using (auth.uid() is not null);

-- Product packages
create table if not exists product_packages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  name text not null,
  gift_product_id uuid references products(id) on delete set null,
  gift_quantity integer not null default 0,
  price numeric(12,2),
  external_ref text,
  created_at timestamptz default now()
);
alter table product_packages enable row level security;
drop policy if exists "product_packages_select_all" on product_packages;
create policy "product_packages_select_all" on product_packages for select using (auth.uid() is not null);
drop policy if exists "product_packages_admin_write" on product_packages;
create policy "product_packages_admin_write" on product_packages for insert with check (is_admin());
drop policy if exists "product_packages_admin_update" on product_packages;
create policy "product_packages_admin_update" on product_packages for update using (is_admin());
drop policy if exists "product_packages_admin_delete" on product_packages;
create policy "product_packages_admin_delete" on product_packages for delete using (is_admin());

-- Foreign keys that depend on tables created above (safe to re-add)
do $$ begin
  alter table orders add constraint orders_package_id_fkey foreign key (package_id) references product_packages(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table orders add constraint orders_forwarded_to_fkey foreign key (forwarded_to) references dispatch_companies(id);
exception when duplicate_object then null;
end $$;

-- Orders: insert/select policies (staff + submitter roles can create; visibility rules)
drop policy if exists "orders_admin_insert" on orders;
drop policy if exists "orders_insert" on orders;
create policy "orders_insert" on orders for insert with check (
  is_admin()
  or exists (select 1 from profiles where id = auth.uid() and role in ('manager','logistics','marketer','staff'))
);

drop policy if exists "orders_select" on orders;
create policy "orders_select" on orders for select using (
  is_admin()
  or staff_id = auth.uid()
  or dispatch_id = auth.uid()
  or created_by = auth.uid()
  or (staff_id is null and exists (select 1 from profiles where id = auth.uid() and role = 'staff'))
);

drop policy if exists "orders_update" on orders;
create policy "orders_update" on orders for update using (
  is_admin()
  or staff_id = auth.uid()
  or dispatch_id = auth.uid()
  or (staff_id is null and exists (select 1 from profiles where id = auth.uid() and role = 'staff'))
);

-- Finally, refresh Supabase's schema cache immediately
NOTIFY pgrst, 'reload schema';
