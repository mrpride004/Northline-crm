-- Trailblazer CRM — v31:
-- (1) Upsell commission is now only ever calculated when the customer is
--     genuinely moving to a HIGHER-PRICED package/set than what they
--     currently have — never for a same-price swap, a correction, or
--     simply being marked paid/reconfirmed. The package change itself is
--     still always allowed (staff sometimes need to fix a mistake), but if
--     it isn't a real upgrade, commission is forced to zero and clearly
--     labeled as "Not an upgrade" so nobody can farm commission by cycling
--     packages back and forth.
-- (2) Per-agent-per-product low stock thresholds, since central inventory
--     and agent inventory can now have different alert levels.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table agent_stock add column if not exists low_stock_threshold integer;

create or replace function create_upsell(
  p_original_order_id uuid,
  p_upsell_product_id uuid,
  p_upsell_package_id uuid,
  p_additional_quantity integer,
  p_unit_price numeric,
  p_upsell_set_id uuid default null
)
returns uuid as $$
declare
  v_order orders%rowtype;
  v_rule upsell_commission_rules%rowtype;
  v_amount numeric(12,2);
  v_commission numeric(12,2);
  v_upsell_id uuid;
  v_superseded_id uuid;
  v_current_amount numeric(12,2);
  v_is_upgrade boolean;
begin
  select * into v_order from orders where id = p_original_order_id;
  if v_order.id is null then
    raise exception 'Order not found';
  end if;
  if v_order.confirmed_at is null then
    raise exception 'The original order must be confirmed before an upsell can be added';
  end if;

  select (additional_quantity * unit_price) into v_current_amount
  from upsells
  where original_order_id = p_original_order_id
    and commission_status not in ('Rejected', 'Reversed')
  order by created_at desc
  limit 1;

  if v_current_amount is null then
    v_current_amount := coalesce(v_order.quantity, 1) * coalesce(v_order.unit_price, 0);
  end if;

  for v_superseded_id in
    select id from upsells
    where original_order_id = p_original_order_id
      and commission_status not in ('Rejected', 'Reversed')
  loop
    update upsells set commission_status = 'Rejected', delivery_status = 'Cancelled' where id = v_superseded_id;
    update commission_ledger set reversed = true where upsell_id = v_superseded_id and reversed = false;
    insert into audit_log (action, order_id, upsell_id, reason)
    values ('Upsell Superseded', p_original_order_id, v_superseded_id, 'Customer moved to a different package again — the previous change no longer applies');
  end loop;

  v_amount := p_additional_quantity * p_unit_price;
  v_is_upgrade := v_amount > v_current_amount;

  if v_is_upgrade then
    select * into v_rule from upsell_commission_rules
    where active = true
      and effective_start <= current_date
      and (effective_end is null or effective_end >= current_date)
      and (original_product_id is null or original_product_id = v_order.product_id)
      and (original_package_id is null or original_package_id = v_order.package_id)
      and (upsell_product_id is null or upsell_product_id = p_upsell_product_id)
      and (upsell_package_id is null or upsell_package_id = p_upsell_package_id)
      and (upsell_set_id is null or upsell_set_id = p_upsell_set_id)
      and (eligible_staff is null or v_order.staff_id = any(eligible_staff))
    order by
      (case when original_product_id is not null then 1 else 0 end
       + case when original_package_id is not null then 1 else 0 end
       + case when upsell_product_id is not null then 1 else 0 end
       + case when upsell_package_id is not null then 1 else 0 end
       + case when upsell_set_id is not null then 1 else 0 end) desc,
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
  else
    v_commission := 0;
  end if;

  insert into upsells (
    original_order_id, staff_id, original_product_id, original_package_id, original_quantity,
    upsell_product_id, upsell_package_id, upsell_set_id, additional_quantity, unit_price, upsell_amount,
    commission_rule_id, commission_rule_snapshot, commission_amount, commission_status
  ) values (
    p_original_order_id, v_order.staff_id, v_order.product_id, v_order.package_id, v_order.quantity,
    p_upsell_product_id, p_upsell_package_id, p_upsell_set_id, p_additional_quantity, p_unit_price, v_amount,
    case when v_is_upgrade then v_rule.id else null end,
    case
      when not v_is_upgrade then jsonb_build_object('note', 'Not an upgrade — no commission', 'previous_amount', v_current_amount, 'new_amount', v_amount)
      when v_rule.id is not null then jsonb_build_object('rule_id', v_rule.id, 'commission_type', v_rule.commission_type, 'commission_value', v_rule.commission_value, 'applied_at', now())
      else null
    end,
    v_commission,
    'Pending'
  ) returning id into v_upsell_id;

  insert into audit_log (actor_id, action, order_id, upsell_id, new_value)
  values (auth.uid(), 'Upsell Created', p_original_order_id, v_upsell_id, v_commission::text || case when not v_is_upgrade then ' (not an upgrade)' else '' end);

  return v_upsell_id;
end;
$$ language plpgsql security definer;

grant execute on function create_upsell(uuid, uuid, uuid, integer, numeric, uuid) to authenticated;

NOTIFY pgrst, 'reload schema';
