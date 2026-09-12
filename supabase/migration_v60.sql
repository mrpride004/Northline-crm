-- Trailblazer CRM — v60: Returns & Refunds module.
--
-- A customer return moves through a fixed workflow, tracked as one row per
-- return request: Requested -> Approved -> Product Received -> Inspection ->
-- Refund/Exchange -> Completed, with Rejected as an early exit from
-- Requested or Approved.
--
-- Inspection is where the physical item is judged sellable or not. The
-- inventory side effect reuses the EXACT same mechanism already built for
-- reversing a delivered order (migration_v56's adjust_stock/
-- adjust_stock_for_set with movement_type='returned', positive delta) —
-- if the item is sellable it goes back into stock the same way a
-- re-cancelled delivery already does; if it's damaged, stock is left alone
-- (the original 'sold' movement already removed it, and it's staying
-- removed). No new stock_movements plumbing needed.
--
-- Refund/exchange amounts are recorded here for visibility but are NOT
-- currently subtracted from revenue in the Profitability report — that
-- would need changes across how order revenue is computed everywhere it's
-- used, and there's no real return data yet to justify that now. Revisit
-- once this module has been used for a while.

create table if not exists returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null default 'Requested' check (status in (
    'Requested', 'Approved', 'Rejected', 'Product Received', 'Inspection', 'Refund/Exchange', 'Completed'
  )),
  reason text not null check (reason in (
    'Wrong size', 'Wrong product', 'Damaged', 'Customer changed mind', 'Product defect', 'Failed delivery', 'Other'
  )),
  reason_note text,
  inspection_outcome text check (inspection_outcome in ('Sellable', 'Damaged')),
  resolution text check (resolution in ('Refund', 'Exchange')),
  refund_amount numeric,
  exchange_product_id uuid references products(id),
  exchange_set_id uuid references product_sets(id),
  requested_by uuid references profiles(id),
  requested_by_name text,
  rejection_note text,
  created_at timestamptz default now(),
  status_updated_at timestamptz default now(),
  resolved_at timestamptz
);

create index if not exists idx_returns_order_id on returns(order_id);
create index if not exists idx_returns_status on returns(status);

alter table returns enable row level security;

-- Similar to order_events: admin and the 'inventory' role (who own this
-- whole module via the Inventory hub) see and file every return; everyone
-- else only for orders they're the staff/dispatch/creator on.
create policy returns_select on returns for select using (
  is_admin()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'inventory')
  or exists (
    select 1 from orders o where o.id = returns.order_id
      and (o.staff_id = auth.uid() or o.dispatch_id = auth.uid() or o.created_by = auth.uid())
  )
);
create policy returns_insert on returns for insert with check (
  is_admin()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'inventory')
  or exists (
    select 1 from orders o where o.id = returns.order_id
      and (o.staff_id = auth.uid() or o.dispatch_id = auth.uid() or o.created_by = auth.uid())
  )
);
-- Progressing the workflow (approve/reject, receive, inspect, resolve,
-- complete) is open to admin AND the 'inventory' role — they're the ones
-- who physically handle a returned item coming back through the door.
-- Removing a request filed in error stays admin-only.
create policy returns_update on returns for update using (
  is_admin() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'inventory')
);
create policy returns_admin_delete on returns for delete using (is_admin());
