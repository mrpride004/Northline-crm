-- Northline CRM — v4 upgrade: manager/logistics/marketer roles with product
-- permissions, order confirmation messaging, and external dispatch forwarding.
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Expand roles and add per-role product access control
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','staff','dispatch','manager','logistics','marketer'));
alter table profiles add column if not exists allowed_products uuid[];

-- 2. Track who submitted each order (needed for "My submissions" views)
alter table orders add column if not exists created_by uuid references profiles(id);

-- 3. Let the new roles create orders, and see orders they created
drop policy if exists "orders_admin_insert" on orders;
create policy "orders_insert" on orders for insert with check (
  is_admin()
  or exists (select 1 from profiles where id = auth.uid() and role in ('manager','logistics','marketer'))
);

drop policy if exists "orders_select" on orders;
create policy "orders_select" on orders for select using (
  is_admin()
  or staff_id = auth.uid()
  or dispatch_id = auth.uid()
  or created_by = auth.uid()
  or (staff_id is null and exists (select 1 from profiles where id = auth.uid() and role = 'staff'))
);

-- 4. App-wide settings (key/value) — controls whether confirmations auto-send
create table if not exists app_settings (
  key text primary key,
  value text
);
alter table app_settings enable row level security;
create policy "app_settings_admin_all" on app_settings for all using (is_admin()) with check (is_admin());
create policy "app_settings_select_all" on app_settings for select using (auth.uid() is not null);

insert into app_settings (key, value) values
  ('sms_auto_confirm', 'false'),
  ('whatsapp_auto_confirm', 'false')
on conflict (key) do nothing;

-- 5. External dispatch companies you haven't onboarded onto the CRM
create table if not exists dispatch_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text not null,
  channel text not null default 'whatsapp' check (channel in ('sms','whatsapp')),
  active boolean not null default true,
  created_at timestamptz default now()
);
alter table dispatch_companies enable row level security;
create policy "dispatch_companies_admin_all" on dispatch_companies for all using (is_admin()) with check (is_admin());
create policy "dispatch_companies_select_all" on dispatch_companies for select using (auth.uid() is not null);

-- 6. Orders can be forwarded to an external dispatch company instead of an internal partner
alter table orders add column if not exists forwarded_to uuid references dispatch_companies(id);
