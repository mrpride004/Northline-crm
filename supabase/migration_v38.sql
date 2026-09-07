-- Trailblazer CRM — v38: Upsell auto-approval. A staff member can now
-- self-approve their own commission on an Eligible upsell — but ONLY when
-- admin has explicitly enabled auto_approve on the matching rule AND
-- granted that specific staff member can_auto_approve_upsell. Everything
-- else about the existing approval gate is untouched: package changes still
-- apply immediately regardless, and commission still only becomes claimable
-- once Delivered + Paid, exactly as before.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table upsell_commission_rules add column if not exists auto_approve boolean not null default false;
alter table profiles add column if not exists can_auto_approve_upsell boolean not null default false;

create or replace function staff_approve_own_upsell(p_upsell_id uuid)
returns void as $$
declare
  v_up upsells%rowtype;
  v_rule upsell_commission_rules%rowtype;
  v_can_auto_approve boolean;
begin
  select * into v_up from upsells where id = p_upsell_id;
  if v_up.id is null then
    raise exception 'Upsell not found';
  end if;
  if v_up.staff_id <> auth.uid() then
    raise exception 'You can only approve your own upsells';
  end if;
  if v_up.commission_status <> 'Eligible' then
    raise exception 'This upsell is not waiting for approval (currently %)', v_up.commission_status;
  end if;

  select can_auto_approve_upsell into v_can_auto_approve from profiles where id = auth.uid();
  if not coalesce(v_can_auto_approve, false) then
    raise exception 'You do not have auto-approval permission';
  end if;

  if v_up.commission_rule_id is not null then
    select * into v_rule from upsell_commission_rules where id = v_up.commission_rule_id;
  end if;
  if v_rule.id is null or not v_rule.auto_approve then
    raise exception 'This upsell''s rule does not allow auto-approval';
  end if;

  update upsells set commission_status = 'Approved' where id = p_upsell_id;
  insert into commission_ledger (order_id, staff_id, product_id, amount, commission_type, cycle_start, upsell_id)
  values (v_up.original_order_id, v_up.staff_id, v_up.upsell_product_id, v_up.commission_amount, 'upsell',
    (current_date - (extract(dow from current_date))::integer), p_upsell_id);
  insert into audit_log (actor_id, action, order_id, upsell_id, new_value)
  values (auth.uid(), 'Commission Auto-Approved by Staff', v_up.original_order_id, p_upsell_id, v_up.commission_amount::text);
end;
$$ language plpgsql security definer;

grant execute on function staff_approve_own_upsell(uuid) to authenticated;

NOTIFY pgrst, 'reload schema';
