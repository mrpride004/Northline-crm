-- Northline CRM — v21: admin can control whether a staff member can create
-- orders at all, and which statuses they're allowed to change an order to.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table profiles add column if not exists can_create_orders boolean not null default true;
alter table profiles add column if not exists allowed_statuses text[];

NOTIFY pgrst, 'reload schema';
