-- Northline CRM — v12: per-person section access permissions, a stock
-- movement ledger (for future date-range exports), and a corrected
-- "send stock to agent" function that also deducts central inventory.
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Which app sections each person can access (null = default access for their role)
alter table profiles add column if not exists allowed_sections text[];

-- 2. Stock movement ledger — every central or agent stock change gets logged here
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  agent_id uuid references profiles(id) on delete set null,
  delta integer not null,
  reason text,
  order_id uuid references orders(id) on delete set null,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  created_at timestamptz default now()
);
alter table stock_movements enable row level security;
drop policy if exists "stock_movements_admin_select" on stock_movements;
create policy "stock_movements_admin_select" on stock_movements for select using (
  is_admin() or agent_id = auth.uid()
);
drop policy if exists "stock_movements_insert" on stock_movements;
create policy "stock_movements_insert" on stock_movements for insert with check (auth.uid() is not null);

-- 3. Re-define adjust_stock / adjust_agent_stock to also log to the ledger
create or replace function adjust_stock(p_product_id uuid, p_delta integer)
returns void as $$
begin
  update products set stock_quantity = greatest(0, stock_quantity + p_delta) where id = p_product_id;
  insert into stock_movements (product_id, delta, reason, actor_id)
  values (p_product_id, p_delta, 'order_delivery_adjustment', auth.uid());
end;
$$ language plpgsql security definer;
grant execute on function adjust_stock(uuid, integer) to authenticated;

create or replace function adjust_agent_stock(p_agent_id uuid, p_product_id uuid, p_delta integer)
returns void as $$
begin
  if auth.uid() <> p_agent_id and not is_admin() then
    raise exception 'Not authorized to adjust this agent''s stock';
  end if;
  insert into agent_stock (agent_id, product_id, quantity)
  values (p_agent_id, p_product_id, greatest(0, p_delta))
  on conflict (agent_id, product_id) do update
    set quantity = greatest(0, agent_stock.quantity + p_delta), updated_at = now();
  insert into stock_movements (product_id, agent_id, delta, reason, actor_id)
  values (p_product_id, p_agent_id, p_delta, 'agent_stock_adjustment', auth.uid());
end;
$$ language plpgsql security definer;
grant execute on function adjust_agent_stock(uuid, uuid, integer) to authenticated;

-- 4. Sending stock to an agent now correctly pulls it out of central inventory
create or replace function send_stock_to_agent(p_agent_id uuid, p_product_id uuid, p_amount integer)
returns void as $$
begin
  if not is_admin() then
    raise exception 'Only admins can send stock to an agent';
  end if;
  update products set stock_quantity = greatest(0, stock_quantity - p_amount) where id = p_product_id;
  insert into agent_stock (agent_id, product_id, quantity)
  values (p_agent_id, p_product_id, greatest(0, p_amount))
  on conflict (agent_id, product_id) do update
    set quantity = greatest(0, agent_stock.quantity + p_amount), updated_at = now();
  insert into stock_movements (product_id, agent_id, delta, reason, actor_id)
  values (p_product_id, p_agent_id, -p_amount, 'sent_to_agent', auth.uid());
  insert into stock_movements (product_id, agent_id, delta, reason, actor_id)
  values (p_product_id, p_agent_id, p_amount, 'received_by_agent', auth.uid());
end;
$$ language plpgsql security definer;
grant execute on function send_stock_to_agent(uuid, uuid, integer) to authenticated;

NOTIFY pgrst, 'reload schema';
