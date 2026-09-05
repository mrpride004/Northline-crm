-- Northline CRM — v6 upgrade: multiple packages per product (each with its
-- own optional gift item), and prep for delivery-time stock deduction.
-- Run in Supabase: SQL Editor > New query > paste all > Run

create table if not exists product_packages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  name text not null,
  gift_product_id uuid references products(id) on delete set null,
  gift_quantity integer not null default 0,
  created_at timestamptz default now()
);
alter table product_packages enable row level security;
create policy "product_packages_select_all" on product_packages for select using (auth.uid() is not null);
create policy "product_packages_admin_write" on product_packages for insert with check (is_admin());
create policy "product_packages_admin_update" on product_packages for update using (is_admin());
create policy "product_packages_admin_delete" on product_packages for delete using (is_admin());

alter table orders add column if not exists package_id uuid references product_packages(id) on delete set null;
