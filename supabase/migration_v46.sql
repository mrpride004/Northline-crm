-- Trailblazer CRM — v46: Consolidated permissions system.
--
-- Before this, staff/dispatch permission-ish settings were scattered across
-- individual buttons on the Team page, an "Edit access" modal, and separate
-- eligible-staff lists buried inside Commission Rule and Order Source
-- modals — hard for an admin to find or reason about as a whole.
--
-- This adds ROLE-LEVEL DEFAULTS: an admin can now set "every Staff member
-- gets X" once, instead of clicking the same toggle for each person. Any
-- person can still be individually overridden.
--
-- New meaning of the affected `profiles` columns from now on:
--   NULL           -> inherit the value from role_permission_defaults
--   explicit value -> override, just for this person
-- (For the array columns, an explicit empty array `{}` means "override to
-- unrestricted/all" — distinct from NULL, which means "inherit".)
--
-- This migration is purely additive/data-preserving: it does not change any
-- person's *effective* permissions today. Run in Supabase: SQL Editor > New
-- query > paste all > Run.

-- 1. Role defaults table -----------------------------------------------

create table if not exists role_permission_defaults (
  role text primary key,
  can_create_orders boolean not null default true,
  can_upsell boolean not null default true,
  can_auto_assign boolean not null default true,
  can_view_dispatch_success_rate boolean not null default false,
  can_auto_approve_upsell boolean not null default false,
  allowed_statuses text[],
  allowed_sections text[],
  allowed_products uuid[],
  updated_at timestamptz not null default now()
);

insert into role_permission_defaults (role, allowed_statuses)
values
  ('staff', array['Confirmed','Rescheduled','Unreachable','Cancelled']),
  ('dispatch', null),
  ('manager', null),
  ('logistics', null),
  ('marketer', null),
  ('inventory', null)
on conflict (role) do nothing;

alter table role_permission_defaults enable row level security;

drop policy if exists "role_defaults_select" on role_permission_defaults;
create policy "role_defaults_select" on role_permission_defaults for select using (auth.uid() is not null);

drop policy if exists "role_defaults_write" on role_permission_defaults;
create policy "role_defaults_write" on role_permission_defaults for all using (is_admin()) with check (is_admin());

-- 2. Free up NULL on profiles to mean "inherit" -------------------------

alter table profiles alter column can_create_orders drop not null;
alter table profiles alter column can_upsell drop not null;
alter table profiles alter column can_auto_assign drop not null;
alter table profiles alter column can_view_dispatch_success_rate drop not null;
alter table profiles alter column can_auto_approve_upsell drop not null;

-- Also drop the column DEFAULTs so a newly created profile that omits these
-- fields comes in as NULL (inherit role default) rather than silently
-- getting the old hardcoded true/false again.
alter table profiles alter column can_create_orders drop default;
alter table profiles alter column can_upsell drop default;
alter table profiles alter column can_auto_assign drop default;
alter table profiles alter column can_view_dispatch_success_rate drop default;
alter table profiles alter column can_auto_approve_upsell drop default;

-- Anyone currently sitting at the old hardcoded default now inherits from
-- the role default instead (identical effective value, now centrally
-- editable). Anyone an admin had already customized away from that default
-- keeps their explicit override untouched.
update profiles set can_create_orders = null where can_create_orders = true;
update profiles set can_upsell = null where can_upsell = true;
update profiles set can_auto_assign = null where can_auto_assign = true;
update profiles set can_view_dispatch_success_rate = null where can_view_dispatch_success_rate = false;
update profiles set can_auto_approve_upsell = null where can_auto_approve_upsell = false;

-- allowed_sections and allowed_products are left exactly as they are: every
-- role's seeded default above is NULL for these two, which the app treats
-- as "unrestricted" — identical to what an existing NULL already meant.
-- So existing profiles now transparently "inherit" a default that resolves
-- to the same unrestricted behavior today, while becoming responsive to a
-- role default an admin sets later (e.g. restricting Marketers to certain
-- products by default). Anyone with an explicit array keeps their override.

-- Staff allowed_statuses is different: its role default is NOT null (it's
-- the specific 4-status list), so an existing NULL there — which used to
-- mean unrestricted — must be pinned to an explicit empty-array override
-- before NULL is repurposed, or that person would suddenly become
-- restricted. Anyone currently at exactly the old creation-time default
-- (regardless of stored order) now inherits from the identical seeded
-- staff role default instead.
update profiles set allowed_statuses = null
  where role = 'staff'
    and allowed_statuses is not null
    and allowed_statuses <@ array['Confirmed','Rescheduled','Unreachable','Cancelled']::text[]
    and array['Confirmed','Rescheduled','Unreachable','Cancelled']::text[] <@ allowed_statuses;
update profiles set allowed_statuses = '{}' where role = 'staff' and allowed_statuses is null;

-- 3. staff_approve_own_upsell: fall back to the staff role default --------

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

  select coalesce(p.can_auto_approve_upsell, d.can_auto_approve_upsell, false) into v_can_auto_approve
  from profiles p left join role_permission_defaults d on d.role = p.role
  where p.id = auth.uid();
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

NOTIFY pgrst, 'reload schema';
