-- Northline CRM — feature upgrade migration
-- Run this in Supabase: SQL Editor > New query > paste all > Run
-- Safe to run once on your existing database (adds to what's already there).

-- 1. Expand order statuses
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('New','Confirmed','Preparing','Dispatched','Delivered','Unreachable','Rescheduled','Cancelled'));

-- 2. Order details: quantity, pricing, payment status, reschedule date, delivered timestamp
alter table orders add column if not exists quantity integer not null default 1;
alter table orders add column if not exists unit_price numeric(12,2);
alter table orders add column if not exists delivery_fee numeric(12,2) not null default 0;
alter table orders add column if not exists payment_status text not null default 'Unpaid'
  check (payment_status in ('Unpaid','Paid','Partial'));
alter table orders add column if not exists reschedule_date date;
alter table orders add column if not exists delivered_at timestamptz;

-- 3. Inventory: stock tracking per product
alter table products add column if not exists stock_quantity integer not null default 0;
alter table products add column if not exists low_stock_threshold integer not null default 5;

-- 4. Order history / remarks / notifications feed
create table if not exists order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  event_type text not null, -- 'created' | 'status_change' | 'remark' | 'assigned'
  from_status text,
  to_status text,
  note text,
  created_at timestamptz default now()
);

alter table order_events enable row level security;

create policy "order_events_select" on order_events for select using (
  is_admin()
  or exists (
    select 1 from orders o where o.id = order_events.order_id
    and (o.staff_id = auth.uid() or o.dispatch_id = auth.uid() or o.staff_id is null)
  )
);

create policy "order_events_insert" on order_events for insert with check (
  is_admin()
  or exists (
    select 1 from orders o where o.id = order_events.order_id
    and (o.staff_id = auth.uid() or o.dispatch_id = auth.uid())
  )
);
