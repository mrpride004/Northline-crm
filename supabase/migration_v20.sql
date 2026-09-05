-- Northline CRM — v20: admin approval is now the real gate for upsell
-- commission. Reaching "Eligible" (delivered + paid) no longer credits the
-- balance automatically — an admin must explicitly Approve it first.
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. sync_upsells_for_order now only marks an upsell Eligible — it no longer
-- inserts a commission_ledger row itself. That only happens on approval.
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
      insert into audit_log (action, order_id, upsell_id, new_value)
      values ('Upsell Eligible — awaiting admin approval', p_order_id, v_up.id, v_up.commission_amount::text);
    end if;
  end loop;
end;
$$ language plpgsql security definer;

grant execute on function sync_upsells_for_order(uuid) to authenticated;

-- 2. Admin approval — the only way an upsell's commission actually gets
-- credited to the staff member's claimable balance.
create or replace function approve_upsell_commission(p_upsell_id uuid)
returns void as $$
declare
  v_up upsells%rowtype;
begin
  if not is_admin() then
    raise exception 'Only admins can approve commission';
  end if;
  select * into v_up from upsells where id = p_upsell_id;
  if v_up.id is null then
    raise exception 'Upsell not found';
  end if;
  if v_up.commission_status <> 'Eligible' then
    raise exception 'This upsell is not waiting for approval (currently %)', v_up.commission_status;
  end if;

  update upsells set commission_status = 'Approved' where id = p_upsell_id;
  insert into commission_ledger (order_id, staff_id, product_id, amount, commission_type, cycle_start, upsell_id)
  values (v_up.original_order_id, v_up.staff_id, v_up.upsell_product_id, v_up.commission_amount, 'upsell',
    (current_date - (extract(dow from current_date))::integer), p_upsell_id);
  insert into audit_log (actor_id, action, order_id, upsell_id, new_value)
  values (auth.uid(), 'Commission Approved', v_up.original_order_id, p_upsell_id, v_up.commission_amount::text);
end;
$$ language plpgsql security definer;

grant execute on function approve_upsell_commission(uuid) to authenticated;

-- 3. Put an eligible upsell on hold instead of approving or rejecting it outright
create or replace function hold_upsell(p_upsell_id uuid, p_reason text)
returns void as $$
begin
  if not is_admin() then
    raise exception 'Only admins can put commission on hold';
  end if;
  update upsells set commission_status = 'On Hold' where id = p_upsell_id;
  insert into audit_log (actor_id, action, upsell_id, reason)
  values (auth.uid(), 'Commission On Hold', p_upsell_id, p_reason);
end;
$$ language plpgsql security definer;

grant execute on function hold_upsell(uuid, text) to authenticated;

NOTIFY pgrst, 'reload schema';
