-- Northline CRM — v22: per-staff upsell rule eligibility, admin order
-- deletion, auto-cancel upsells when an order is cancelled, and staff can
-- withdraw their own not-yet-eligible upsell.
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Upsell commission rules can now also be restricted to specific staff
alter table upsell_commission_rules add column if not exists eligible_staff uuid[];

-- 2. Re-create create_upsell and test_upsell_commission to respect eligible_staff
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

  select * into v_rule from upsell_commission_rules
  where active = true
    and effective_start <= current_date
    and (effective_end is null or effective_end >= current_date)
    and (original_product_id is null or original_product_id = v_order.product_id)
    and (original_package_id is null or original_package_id = v_order.package_id)
    and (upsell_product_id is null or upsell_product_id = p_upsell_product_id)
    and (upsell_package_id is null or upsell_package_id = p_upsell_package_id)
    and (eligible_staff is null or v_order.staff_id = any(eligible_staff))
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

create or replace function test_upsell_commission(
  p_original_product_id uuid,
  p_original_package_id uuid,
  p_upsell_product_id uuid,
  p_upsell_package_id uuid,
  p_additional_quantity integer,
  p_unit_price numeric
)
returns table (
  rule_id uuid,
  commission_type text,
  commission_value numeric,
  specificity integer,
  calculated_commission numeric
) as $$
declare
  v_rule upsell_commission_rules%rowtype;
  v_amount numeric(12,2);
  v_commission numeric(12,2);
  v_specificity integer;
begin
  v_amount := p_additional_quantity * p_unit_price;

  select * into v_rule from upsell_commission_rules
  where active = true
    and effective_start <= current_date
    and (effective_end is null or effective_end >= current_date)
    and (original_product_id is null or original_product_id = p_original_product_id)
    and (original_package_id is null or original_package_id = p_original_package_id)
    and (upsell_product_id is null or upsell_product_id = p_upsell_product_id)
    and (upsell_package_id is null or upsell_package_id = p_upsell_package_id)
  order by
    (case when original_product_id is not null then 1 else 0 end
     + case when original_package_id is not null then 1 else 0 end
     + case when upsell_product_id is not null then 1 else 0 end
     + case when upsell_package_id is not null then 1 else 0 end) desc,
    created_at asc
  limit 1;

  if v_rule.id is null then
    return;
  end if;

  v_specificity := (case when v_rule.original_product_id is not null then 1 else 0 end
    + case when v_rule.original_package_id is not null then 1 else 0 end
    + case when v_rule.upsell_product_id is not null then 1 else 0 end
    + case when v_rule.upsell_package_id is not null then 1 else 0 end);

  v_commission := case v_rule.commission_type
    when 'percentage' then v_amount * (v_rule.commission_value / 100)
    when 'per_unit' then v_rule.commission_value * p_additional_quantity
    else v_rule.commission_value
  end;

  return query select v_rule.id, v_rule.commission_type, v_rule.commission_value, v_specificity, v_commission;
end;
$$ language plpgsql security definer;

grant execute on function test_upsell_commission(uuid, uuid, uuid, uuid, integer, numeric) to authenticated;

-- 3. Admins can permanently delete an order
drop policy if exists "orders_admin_delete" on orders;
create policy "orders_admin_delete" on orders for delete using (is_admin());

-- 4. Auto-cancel any active upsells when the parent order is cancelled
create or replace function cancel_upsells_for_order(p_order_id uuid)
returns void as $$
begin
  update upsells set commission_status = 'Rejected', delivery_status = 'Cancelled'
  where original_order_id = p_order_id and commission_status not in ('Rejected', 'Reversed');
  update commission_ledger set reversed = true
  where upsell_id in (select id from upsells where original_order_id = p_order_id) and reversed = false;
  insert into audit_log (action, order_id, reason)
  values ('Upsells auto-cancelled with order', p_order_id, 'Parent order was cancelled');
end;
$$ language plpgsql security definer;

grant execute on function cancel_upsells_for_order(uuid) to authenticated;

-- 5. Staff can withdraw their own upsell while it's still Pending (customer changed their mind)
create or replace function withdraw_upsell(p_upsell_id uuid)
returns void as $$
declare
  v_up upsells%rowtype;
begin
  select * into v_up from upsells where id = p_upsell_id;
  if v_up.id is null then
    raise exception 'Upsell not found';
  end if;
  if v_up.staff_id <> auth.uid() and not is_admin() then
    raise exception 'You can only withdraw your own upsells';
  end if;
  if v_up.commission_status <> 'Pending' then
    raise exception 'This upsell is already past Pending and can no longer be withdrawn directly — ask an admin to cancel it instead';
  end if;
  update upsells set commission_status = 'Rejected', delivery_status = 'Cancelled' where id = p_upsell_id;
  insert into audit_log (actor_id, action, upsell_id, reason)
  values (auth.uid(), 'Upsell Withdrawn by Staff', p_upsell_id, 'Customer no longer wants the upsell');
end;
$$ language plpgsql security definer;

grant execute on function withdraw_upsell(uuid) to authenticated;

NOTIFY pgrst, 'reload schema';
