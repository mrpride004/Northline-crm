-- Northline CRM — v19: read-only rule-testing function (Phase 2, part 1).
-- Lets admin test what commission a hypothetical upsell would earn, without
-- creating any real record. Uses the exact same matching logic as the live
-- create_upsell function, so test results are always accurate.
-- Run in Supabase: SQL Editor > New query > paste all > Run

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

-- Admin-only cancellation of a pending/eligible upsell (reverses any commission already booked)
create or replace function cancel_upsell(p_upsell_id uuid, p_reason text)
returns void as $$
declare
  v_up upsells%rowtype;
begin
  if not is_admin() then
    raise exception 'Only admins can cancel an upsell';
  end if;
  select * into v_up from upsells where id = p_upsell_id;
  if v_up.id is null then
    raise exception 'Upsell not found';
  end if;

  update upsells set commission_status = 'Rejected', delivery_status = 'Cancelled' where id = p_upsell_id;
  update commission_ledger set reversed = true where upsell_id = p_upsell_id and reversed = false;

  insert into audit_log (actor_id, action, upsell_id, reason)
  values (auth.uid(), 'Upsell Cancelled', p_upsell_id, p_reason);
end;
$$ language plpgsql security definer;

grant execute on function cancel_upsell(uuid, text) to authenticated;

NOTIFY pgrst, 'reload schema';
