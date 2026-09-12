-- Trailblazer CRM — v56: full inventory subsystem.
--
-- Builds on the existing stock_movements ledger (already recording every
-- change to products.stock_quantity and agent_stock.quantity) instead of
-- replacing it. Two additions:
--
-- 1. movement_type classifies each row as received / sold / returned /
--    damaged / transfer / adjustment, instead of only a freeform reason
--    string. Existing rows are backfilled from their old reason value so
--    history isn't lost; adjust_stock and adjust_agent_stock now accept
--    (and log) a movement_type, with a default that keeps every existing
--    call site working unchanged.
--
-- 2. suppliers is a simple contact-book table for where stock comes from.
--    stock_movements.supplier_id (nullable) links a "received" movement to
--    who supplied it — optional, so logging stock-in without a supplier on
--    file still works.
--
-- "Reserved" and "available" stock are deliberately NOT new stored columns
-- — they're computed in the app from live order statuses (reserved = sum
-- of quantity on orders not yet Delivered/Cancelled; available = on-hand
-- minus reserved), so they're always consistent with the orders table and
-- never drift out of sync the way a duplicated counter would.
--
-- Already applied directly to production via the Supabase MCP connection.
-- Kept here as the source-of-truth record of the schema change.

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  notes text,
  created_at timestamptz default now()
);

alter table suppliers enable row level security;

create policy suppliers_select_all on suppliers
  for select using (auth.uid() is not null);
create policy suppliers_admin_write on suppliers
  for insert with check (is_admin());
create policy suppliers_admin_update on suppliers
  for update using (is_admin());
create policy suppliers_admin_delete on suppliers
  for delete using (is_admin());

alter table stock_movements add column if not exists movement_type text;
alter table stock_movements add column if not exists supplier_id uuid references suppliers(id) on delete set null;

update stock_movements set movement_type = case
  when reason = 'order_delivery_adjustment' and delta < 0 then 'sold'
  when reason = 'order_delivery_adjustment' and delta >= 0 then 'returned'
  when reason in ('agent_stock_adjustment', 'sent_to_agent', 'received_by_agent') then 'transfer'
  else 'adjustment'
end
where movement_type is null;

alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('received', 'sold', 'returned', 'damaged', 'transfer', 'adjustment'));

-- adjust_stock: same signature as before for the first two positional args,
-- so every existing call site (order delivery/reversal, manual add/subtract/
-- set-exact) keeps working without changes. New optional args default to
-- the old generic behavior.
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_delta integer,
  p_movement_type text default 'adjustment',
  p_reason text default 'order_delivery_adjustment',
  p_supplier_id uuid default null,
  p_order_id uuid default null
)
returns void
language plpgsql
security definer
as $$
begin
  update products set stock_quantity = greatest(0, stock_quantity + p_delta) where id = p_product_id;
  insert into stock_movements (product_id, delta, reason, actor_id, movement_type, supplier_id, order_id)
  values (p_product_id, p_delta, p_reason, auth.uid(), p_movement_type, p_supplier_id, p_order_id);
end;
$$;

create or replace function public.adjust_agent_stock(
  p_agent_id uuid,
  p_product_id uuid,
  p_delta integer,
  p_movement_type text default 'transfer',
  p_order_id uuid default null
)
returns void
language plpgsql
security definer
as $$
begin
  if auth.uid() <> p_agent_id and not is_admin() then
    raise exception 'Not authorized to adjust this agent''s stock';
  end if;
  insert into agent_stock (agent_id, product_id, quantity)
  values (p_agent_id, p_product_id, greatest(0, p_delta))
  on conflict (agent_id, product_id) do update
    set quantity = greatest(0, agent_stock.quantity + p_delta), updated_at = now();
  insert into stock_movements (product_id, agent_id, delta, reason, actor_id, movement_type, order_id)
  values (p_product_id, p_agent_id, p_delta, 'agent_stock_adjustment', auth.uid(), p_movement_type, p_order_id);
end;
$$;

-- Set-bundle variants: forward the new movement_type/order_id through to
-- each component product's adjust_stock / adjust_agent_stock call so a
-- delivered/reversed set order is tagged the same way a single-product
-- order is, instead of always falling back to the generic default.
create or replace function public.adjust_stock_for_set(
  p_set_id uuid,
  p_delta_units integer,
  p_movement_type text default 'adjustment',
  p_order_id uuid default null
)
returns void
language plpgsql
security definer
as $$
declare
  item record;
begin
  for item in select product_id, quantity_per_set from product_set_items where set_id = p_set_id loop
    perform adjust_stock(item.product_id, item.quantity_per_set * p_delta_units, p_movement_type, 'order_delivery_adjustment', null, p_order_id);
  end loop;
end;
$$;

create or replace function public.adjust_agent_stock_for_set(
  p_agent_id uuid,
  p_set_id uuid,
  p_delta_units integer,
  p_movement_type text default 'transfer',
  p_order_id uuid default null
)
returns void
language plpgsql
security definer
as $$
declare
  item record;
begin
  for item in select product_id, quantity_per_set from product_set_items where set_id = p_set_id loop
    perform adjust_agent_stock(p_agent_id, item.product_id, item.quantity_per_set * p_delta_units, p_movement_type, p_order_id);
  end loop;
end;
$$;

-- send_stock_to_agent / collect_agent_stock / confirm_stock_received are the
-- admin-facing "move stock to/from a dispatch partner" actions (used by
-- AgentStockPage) — same idea as adjust_agent_stock above but transactional
-- (central and agent stock move together, or a collect/confirm round trip).
-- Tag their movements explicitly instead of falling through to the generic
-- default, so the inventory log shows them as transfers too.
create or replace function public.send_stock_to_agent(p_agent_id uuid, p_product_id uuid, p_amount integer)
returns void
language plpgsql
security definer
as $$
declare
  current_stock integer;
begin
  if not is_admin() then
    raise exception 'Only admins can send stock to an agent';
  end if;
  select stock_quantity into current_stock from products where id = p_product_id;
  if current_stock is null or current_stock < p_amount then
    raise exception 'Not enough stock in central inventory (have %, tried to send %)', coalesce(current_stock, 0), p_amount;
  end if;
  update products set stock_quantity = stock_quantity - p_amount where id = p_product_id;
  insert into agent_stock (agent_id, product_id, quantity)
  values (p_agent_id, p_product_id, greatest(0, p_amount))
  on conflict (agent_id, product_id) do update
    set quantity = greatest(0, agent_stock.quantity + p_amount), updated_at = now();
  insert into stock_movements (product_id, agent_id, delta, reason, actor_id, movement_type)
  values (p_product_id, p_agent_id, -p_amount, 'sent_to_agent', auth.uid(), 'transfer');
  insert into stock_movements (product_id, agent_id, delta, reason, actor_id, movement_type)
  values (p_product_id, p_agent_id, p_amount, 'received_by_agent', auth.uid(), 'transfer');
end;
$$;

create or replace function public.collect_agent_stock(p_agent_id uuid, p_product_id uuid, p_quantity integer)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_name text;
begin
  if not is_admin() then
    raise exception 'Only admin can collect agent stock';
  end if;
  select full_name into v_name from profiles where id = auth.uid();
  perform adjust_agent_stock(p_agent_id, p_product_id, -p_quantity, 'transfer');
  insert into agent_stock_retrievals (agent_id, product_id, quantity, collected_by, collected_by_name)
  values (p_agent_id, p_product_id, p_quantity, auth.uid(), v_name)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.confirm_stock_received(p_retrieval_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_row agent_stock_retrievals%rowtype;
begin
  if not is_admin() then
    raise exception 'Only admin can confirm receipt';
  end if;
  select * into v_row from agent_stock_retrievals where id = p_retrieval_id;
  if v_row.id is null or v_row.status = 'Received' then
    raise exception 'Nothing to receive';
  end if;
  perform adjust_stock(v_row.product_id, v_row.quantity, 'transfer');
  update agent_stock_retrievals set status = 'Received', received_by = auth.uid(), received_at = now() where id = p_retrieval_id;
end;
$$;
