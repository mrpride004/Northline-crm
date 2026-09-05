-- Northline CRM — v18: fraud-proof upsell commission system (Phase 1).
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Immutable snapshot of the original order, taken the moment it's confirmed
create table if not exists original_order_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  customer text,
  phone text,
  product_id uuid references products(id),
  package_id uuid references product_packages(id),
  quantity integer,
  unit_price numeric(12,2),
  total_amount numeric(12,2),
  discount numeric(12,2) default 0,
  staff_id uuid references profiles(id),
  created_at timestamptz,
  confirmed_at timestamptz,
  order_source text default 'staff',
  original_status text,
  snapshot_taken_at timestamptz default now(),
  unique(order_id)
);
alter table original_order_snapshots enable row level security;
drop policy if exists "snapshots_select" on original_order_snapshots;
create policy "snapshots_select" on original_order_snapshots for select using (
  is_admin() or exists (select 1 from orders o where o.id = order_id and (o.staff_id = auth.uid() or o.dispatch_id = auth.uid()))
);
drop policy if exists "snapshots_insert" on original_order_snapshots;
create policy "snapshots_insert" on original_order_snapshots for insert with check (auth.uid() is not null);

-- 2. Dynamic, versioned upsell commission rules (admin-only, per product/package combination)
create table if not exists upsell_commission_rules (
  id uuid primary key default gen_random_uuid(),
  original_product_id uuid references products(id),
  original_package_id uuid references product_packages(id),
  upsell_product_id uuid references products(id),
  upsell_package_id uuid references product_packages(id),
  commission_type text not null check (commission_type in ('fixed','percentage','per_unit','per_package','per_event')),
  commission_value numeric(12,2) not null default 0,
  active boolean not null default true,
  effective_start date not null default current_date,
  effective_end date,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz default now()
);
alter table upsell_commission_rules enable row level security;
drop policy if exists "upsell_rules_select_all" on upsell_commission_rules;
create policy "upsell_rules_select_all" on upsell_commission_rules for select using (auth.uid() is not null);
drop policy if exists "upsell_rules_admin_write" on upsell_commission_rules;
create policy "upsell_rules_admin_write" on upsell_commission_rules for insert with check (is_admin());
drop policy if exists "upsell_rules_admin_update" on upsell_commission_rules;
create policy "upsell_rules_admin_update" on upsell_commission_rules for update using (is_admin());
drop policy if exists "upsell_rules_admin_delete" on upsell_commission_rules;
create policy "upsell_rules_admin_delete" on upsell_commission_rules for delete using (is_admin());

-- 3. Upsells: always a separate record, never an edit to the original order
create table if not exists upsells (
  id uuid primary key default gen_random_uuid(),
  original_order_id uuid references orders(id) on delete cascade,
  staff_id uuid references profiles(id),
  original_product_id uuid references products(id),
  original_package_id uuid references product_packages(id),
  original_quantity integer,
  upsell_product_id uuid references products(id),
  upsell_package_id uuid references product_packages(id),
  additional_quantity integer not null default 1,
  unit_price numeric(12,2) not null default 0,
  upsell_amount numeric(12,2) not null default 0,
  customer_confirmed boolean not null default true,
  payment_status text not null default 'Unpaid' check (payment_status in ('Unpaid','Paid')),
  delivery_status text not null default 'Pending' check (delivery_status in ('Pending','Delivered','Cancelled')),
  commission_rule_id uuid references upsell_commission_rules(id),
  commission_rule_snapshot jsonb,
  commission_amount numeric(12,2) not null default 0,
  commission_status text not null default 'Pending' check (commission_status in ('Pending','On Hold','Eligible','Approved','Paid','Reversed','Rejected')),
  created_at timestamptz default now()
);
alter table upsells enable row level security;
drop policy if exists "upsells_select" on upsells;
create policy "upsells_select" on upsells for select using (
  is_admin() or staff_id = auth.uid()
  or exists (select 1 from orders o where o.id = original_order_id and o.dispatch_id = auth.uid())
);
drop policy if exists "upsells_insert" on upsells;
create policy "upsells_insert" on upsells for insert with check (auth.uid() is not null);
drop policy if exists "upsells_update" on upsells;
create policy "upsells_update" on upsells for update using (auth.uid() is not null);

-- 4. Order correction requests — the only way to change a locked/confirmed order
create table if not exists order_corrections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  field text not null,
  original_value text,
  requested_value text,
  reason text,
  requested_by uuid references profiles(id),
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);
alter table order_corrections enable row level security;
drop policy if exists "corrections_select" on order_corrections;
create policy "corrections_select" on order_corrections for select using (
  is_admin() or requested_by = auth.uid()
);
drop policy if exists "corrections_insert" on order_corrections;
create policy "corrections_insert" on order_corrections for insert with check (auth.uid() is not null);
drop policy if exists "corrections_admin_update" on order_corrections;
create policy "corrections_admin_update" on order_corrections for update using (is_admin());

-- 5. Audit log — append-only, nobody can update or delete (no policy = denied by default)
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  actor_name text,
  action text not null,
  order_id uuid,
  upsell_id uuid,
  previous_value text,
  new_value text,
  reason text,
  created_at timestamptz default now()
);
alter table audit_log enable row level security;
drop policy if exists "audit_log_admin_select" on audit_log;
create policy "audit_log_admin_select" on audit_log for select using (is_admin());
drop policy if exists "audit_log_insert" on audit_log;
create policy "audit_log_insert" on audit_log for insert with check (auth.uid() is not null);
-- Deliberately no update/delete policy on audit_log — makes it append-only.

-- 6. Database-level lock: once an order leaves "New", only admin can change its
-- original product, package, quantity, price, or assigned staff.
create or replace function lock_confirmed_order_fields()
returns trigger as $$
begin
  if OLD.status <> 'New' and not is_admin() then
    if NEW.product_id is distinct from OLD.product_id
       or NEW.package_id is distinct from OLD.package_id
       or NEW.quantity is distinct from OLD.quantity
       or NEW.unit_price is distinct from OLD.unit_price
       or NEW.staff_id is distinct from OLD.staff_id then
      raise exception 'This order is confirmed — original product, package, quantity, price, and assigned staff are locked. Use Request Correction instead.';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_lock_confirmed_order on orders;
create trigger trg_lock_confirmed_order
before update on orders
for each row execute function lock_confirmed_order_fields();

-- 7. Extend the existing commission ledger to optionally link to an upsell record
alter table commission_ledger add column if not exists upsell_id uuid references upsells(id);

-- 8. Server-side upsell creation: matches the best commission rule and
-- calculates the commission amount. Staff never supply the amount — this
-- function computes it, so the number can't be manipulated from the client.
create or replace function create_upsell(
  p_original_order_id uuid,
  p_upsell_product_id uuid,
  p_upsell_package_id uuid,
  p_additional_quantity integer,
  p_unit_price numeric
)
returns uuid as $$
declare
  v_order orders%rowtype;
  v_rule upsell_commission_rules%rowtype;
  v_amount numeric(12,2);
  v_commission numeric(12,2);
  v_upsell_id uuid;
begin
  select * into v_order from orders where id = p_original_order_id;
  if v_order.id is null then
    raise exception 'Order not found';
  end if;
  if v_order.confirmed_at is null then
    raise exception 'The original order must be confirmed before an upsell can be added';
  end if;

  v_amount := p_additional_quantity * p_unit_price;

  -- Priority: most specific match wins (exact product+package on both sides first,
  -- down to a fully general fallback rule with all fields null).
  select * into v_rule from upsell_commission_rules
  where active = true
    and effective_start <= current_date
    and (effective_end is null or effective_end >= current_date)
    and (original_product_id is null or original_product_id = v_order.product_id)
    and (original_package_id is null or original_package_id = v_order.package_id)
    and (upsell_product_id is null or upsell_product_id = p_upsell_product_id)
    and (upsell_package_id is null or upsell_package_id = p_upsell_package_id)
  order by
    (case when original_product_id is not null then 1 else 0 end
     + case when original_package_id is not null then 1 else 0 end
     + case when upsell_product_id is not null then 1 else 0 end
     + case when upsell_package_id is not null then 1 else 0 end) desc,
    created_at asc
  limit 1;

  if v_rule.id is not null then
    v_commission := case v_rule.commission_type
      when 'percentage' then v_amount * (v_rule.commission_value / 100)
      when 'per_unit' then v_rule.commission_value * p_additional_quantity
      else v_rule.commission_value
    end;
  else
    v_commission := 0;
  end if;

  insert into upsells (
    original_order_id, staff_id, original_product_id, original_package_id, original_quantity,
    upsell_product_id, upsell_package_id, additional_quantity, unit_price, upsell_amount,
    commission_rule_id, commission_rule_snapshot, commission_amount, commission_status
  ) values (
    p_original_order_id, v_order.staff_id, v_order.product_id, v_order.package_id, v_order.quantity,
    p_upsell_product_id, p_upsell_package_id, p_additional_quantity, p_unit_price, v_amount,
    v_rule.id,
    case when v_rule.id is not null then jsonb_build_object(
      'rule_id', v_rule.id, 'commission_type', v_rule.commission_type, 'commission_value', v_rule.commission_value,
      'applied_at', now()
    ) else null end,
    v_commission,
    'Pending'
  ) returning id into v_upsell_id;

  insert into audit_log (actor_id, action, order_id, upsell_id, new_value)
  values (auth.uid(), 'Upsell Created', p_original_order_id, v_upsell_id, v_commission::text);

  return v_upsell_id;
end;
$$ language plpgsql security definer;

grant execute on function create_upsell(uuid, uuid, uuid, integer, numeric) to authenticated;

-- 9. When an upsell's parent order is delivered+paid, mark the upsell eligible
-- and credit the commission — called from the app, not automatic on a timer.
create or replace function sync_upsells_for_order(p_order_id uuid)
returns void as $$
declare
  v_order orders%rowtype;
  v_up record;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order.id is null then return; end if;

  for v_up in select * from upsells where original_order_id = p_order_id and commission_status = 'Pending' loop
    update upsells set
      delivery_status = case when v_order.status = 'Delivered' then 'Delivered' else delivery_status end,
      payment_status = case when v_order.payment_status = 'Paid' then 'Paid' else payment_status end
    where id = v_up.id;

    if v_order.status = 'Delivered' and v_order.payment_status = 'Paid' and v_up.commission_amount > 0 then
      update upsells set commission_status = 'Eligible' where id = v_up.id;
      insert into commission_ledger (order_id, staff_id, product_id, amount, commission_type, cycle_start, upsell_id)
      values (p_order_id, v_up.staff_id, v_up.upsell_product_id, v_up.commission_amount, 'upsell', (current_date - (extract(dow from current_date))::integer), v_up.id);
      insert into audit_log (action, order_id, upsell_id, new_value)
      values ('Commission Calculated', p_order_id, v_up.id, v_up.commission_amount::text);
    end if;
  end loop;
end;
$$ language plpgsql security definer;

grant execute on function sync_upsells_for_order(uuid) to authenticated;

NOTIFY pgrst, 'reload schema';

