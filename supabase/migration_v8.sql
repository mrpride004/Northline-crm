-- Northline CRM — v8 upgrade: let staff create orders directly (not just
-- managers/logistics/marketers/admin).
-- Run in Supabase: SQL Editor > New query > paste all > Run

drop policy if exists "orders_insert" on orders;
create policy "orders_insert" on orders for insert with check (
  is_admin()
  or exists (select 1 from profiles where id = auth.uid() and role in ('manager','logistics','marketer','staff'))
);
