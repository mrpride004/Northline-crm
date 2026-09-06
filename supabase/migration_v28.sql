-- Trailblazer CRM — v28: Product Sets — bundle multiple distinct products
-- together as one sellable unit. A product can belong to several sets at
-- once. Stock is never tracked separately for the set itself — it's always
-- derived live from its component products, and every component's stock
-- (central + whichever agent holds it) moves automatically whenever a
-- set-based order is delivered, cancelled-after-delivery, or otherwise
-- changes status, exactly like a normal single-product order already does.
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Products can optionally have a default price, used when a Set's price
-- is set to "sum of components" instead of one flat price.
alter table products add column if not exists default_price numeric(12,2);

-- 2. A Set is just a name + a pricing rule; its actual components live in
-- product_set_items below. A product can appear in many sets.
create table if not exists product_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_mode text not null default 'flat' check (price_mode in ('flat', 'sum')),
  flat_price numeric(12,2),
  active boolean not null default true,
  created_at timestamptz default now()
);
alter table product_sets enable row level security;
drop policy if exists "product_sets_select_all" on product_sets;
create policy "product_sets_select_all" on product_sets for select using (auth.uid() is not null);
drop policy if exists "product_sets_admin_write" on product_sets;
create policy "product_sets_admin_write" on product_sets for insert with check (is_admin());
drop policy if exists "product_sets_admin_update" on product_sets;
create policy "product_sets_admin_update" on product_sets for update using (is_admin());
drop policy if exists "product_sets_admin_delete" on product_sets;
create policy "product_sets_admin_delete" on product_sets for delete using (is_admin());

create table if not exists product_set_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid references product_sets(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  quantity_per_set integer not null default 1,
  unique(set_id, product_id)
);
alter table product_set_items enable row level security;
drop policy if exists "product_set_items_select_all" on product_set_items;
create policy "product_set_items_select_all" on product_set_items for select using (auth.uid() is not null);
drop policy if exists "product_set_items_admin_write" on product_set_items;
create policy "product_set_items_admin_write" on product_set_items for insert with check (is_admin());
drop policy if exists "product_set_items_admin_update" on product_set_items;
create policy "product_set_items_admin_update" on product_set_items for update using (is_admin());
drop policy if exists "product_set_items_admin_delete" on product_set_items;
create policy "product_set_items_admin_delete" on product_set_items for delete using (is_admin());

-- 3. Orders can now reference a Set instead of a single product.
alter table orders add column if not exists set_id uuid references product_sets(id);

-- 4. Whether a Set has enough stock for a given quantity — every component
-- must have enough, otherwise the whole set is unavailable.
create or replace function set_stock_available(p_set_id uuid, p_quantity integer)
returns boolean as $$
declare
  v_short boolean;
begin
  select exists (
    select 1 from product_set_items psi
    join products p on p.id = psi.product_id
    where psi.set_id = p_set_id
      and p.stock_quantity < psi.quantity_per_set * p_quantity
  ) into v_short;
  return not v_short;
end;
$$ language plpgsql stable;

-- 5. Central-inventory deduction/restoration for a whole set at once —
-- mirrors adjust_stock, but applies to every component product.
create or replace function adjust_stock_for_set(p_set_id uuid, p_delta_units integer)
returns void as $$
declare
  item record;
begin
  for item in select product_id, quantity_per_set from product_set_items where set_id = p_set_id loop
    perform adjust_stock(item.product_id, item.quantity_per_set * p_delta_units);
  end loop;
end;
$$ language plpgsql security definer;
grant execute on function adjust_stock_for_set(uuid, integer) to authenticated;

-- 6. Same, but for a specific dispatch agent's own stock.
create or replace function adjust_agent_stock_for_set(p_agent_id uuid, p_set_id uuid, p_delta_units integer)
returns void as $$
declare
  item record;
begin
  for item in select product_id, quantity_per_set from product_set_items where set_id = p_set_id loop
    perform adjust_agent_stock(p_agent_id, item.product_id, item.quantity_per_set * p_delta_units);
  end loop;
end;
$$ language plpgsql security definer;
grant execute on function adjust_agent_stock_for_set(uuid, uuid, integer) to authenticated;

NOTIFY pgrst, 'reload schema';
