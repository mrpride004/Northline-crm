-- Trailblazer CRM — v58: dispatch remittance tracking.
--
-- payment_status on an order already answers "has this order's money been
-- confirmed received" (Paid/Unpaid/Partial) — but for COD orders that
-- confirmation happens the moment the dispatch agent collects cash at the
-- door, which is NOT the same moment the agent hands that cash over to the
-- company. Today there's no record of the second event at all, so admin has
-- no way to see how much cash a given dispatch agent is currently holding
-- ("collected but not yet remitted").
--
-- remittances is a simple ledger of hand-over events: an admin records that
-- a dispatch agent handed in a given amount on a given date. It is
-- deliberately NOT tied 1:1 to individual orders — agents typically remit
-- accumulated cash periodically, not per delivery — so the app computes
-- "collected" per agent from orders (Delivered + Paid + COD) and compares it
-- against the sum of their remittances to get "outstanding" (cash they
-- should still hand over). This mirrors how "reserved"/"available" stock is
-- computed rather than stored (see migration_v56) — always consistent with
-- the orders table, never a duplicated counter that can drift.
--
-- "Delivery attempts" (the other half of this task) needs no new schema —
-- it's computed in the app from the existing order_events log (status_change
-- events landing on Unreachable / Rescheduled / Failed Delivery before an
-- order's final outcome).

create table if not exists remittances (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  remittance_date date not null default current_date,
  note text,
  recorded_by uuid references profiles(id),
  recorded_by_name text,
  created_at timestamptz default now()
);

create index if not exists idx_remittances_dispatch_id on remittances(dispatch_id);

alter table remittances enable row level security;

-- Admin sees every remittance; a dispatch agent can see their own (so they
-- can check what's already been credited to them) but only admin logs or
-- corrects entries — admin is the one physically receiving the cash.
create policy remittances_select on remittances
  for select using (is_admin() or dispatch_id = auth.uid());
create policy remittances_admin_insert on remittances
  for insert with check (is_admin());
create policy remittances_admin_update on remittances
  for update using (is_admin());
create policy remittances_admin_delete on remittances
  for delete using (is_admin());
