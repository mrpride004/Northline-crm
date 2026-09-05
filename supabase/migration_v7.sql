-- Northline CRM — v7 upgrade: username login, Inventory Manager role,
-- package pricing + WordPress reference codes.
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Add Inventory Manager as a real role
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','staff','dispatch','manager','logistics','marketer','inventory'));

-- 2. Username for login (in addition to email)
alter table profiles add column if not exists username text unique;

-- 3. Package pricing and a reference code for matching WordPress/WooCommerce products
alter table product_packages add column if not exists price numeric(12,2);
alter table product_packages add column if not exists external_ref text;
