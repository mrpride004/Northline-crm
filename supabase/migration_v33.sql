-- Trailblazer CRM — v33: new staff permission flags (default ON, per your
-- answer) and the agent inventory collection/retraction workflow.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table profiles add column if not exists can_upsell boolean not null default true;
alter table profiles add column if not exists can_auto_assign boolean not null default true;
alter table profiles add column if not exists can_view_dispatch_success_rate boolean not null default false;

-- Deleting an upsell rule must never fail or corrupt historical orders —
-- every past upsell already keeps its own commission_rule_snapshot, so the
-- rule itself is safe to remove once created.
alter table upsells drop constraint if exists upsells_commission_rule_id_fkey;
alter table upsells add constraint upsells_commission_rule_id_fkey
  foreign key (commission_rule_id) references upsell_commission_rules(id) on delete set null;

create table if not exists agent_stock_retrievals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references profiles(id),
  product_id uuid references products(id),
  quantity integer not null,
  collected_by uuid references profiles(id),
  collected_by_name text,
  collected_at timestamptz default now(),
  status text not null default 'Pending Receipt' check (status in ('Pending Receipt', 'Received')),
  received_by uuid references profiles(id),
  received_at timestamptz
);
alter table agent_stock_retrievals enable row level security;
drop policy if exists "retrievals_admin_all" on agent_stock_retrievals;
create policy "retrievals_admin_all" on agent_stock_retrievals for all using (is_admin());

-- Collect stock from an agent — deducts immediately from their available
-- stock, but does NOT add it back to central inventory yet. It sits as
-- "Pending Receipt" until admin explicitly confirms it physically arrived.
create or replace function collect_agent_stock(p_agent_id uuid, p_product_id uuid, p_quantity integer)
returns uuid as $$
declare
  v_id uuid;
  v_name text;
begin
  if not is_admin() then
    raise exception 'Only admin can collect agent stock';
  end if;
  select full_name into v_name from profiles where id = auth.uid();
  perform adjust_agent_stock(p_agent_id, p_product_id, -p_quantity);
  insert into agent_stock_retrievals (agent_id, product_id, quantity, collected_by, collected_by_name)
  values (p_agent_id, p_product_id, p_quantity, auth.uid(), v_name)
  returning id into v_id;
  return v_id;
end;
$$ language plpgsql security definer;
grant execute on function collect_agent_stock(uuid, uuid, integer) to authenticated;

-- Admin confirms the collected stock has physically arrived — only NOW does
-- it get added back to central/main inventory.
create or replace function confirm_stock_received(p_retrieval_id uuid)
returns void as $$
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
  perform adjust_stock(v_row.product_id, v_row.quantity);
  update agent_stock_retrievals set status = 'Received', received_by = auth.uid(), received_at = now() where id = p_retrieval_id;
end;
$$ language plpgsql security definer;
grant execute on function confirm_stock_received(uuid) to authenticated;

NOTIFY pgrst, 'reload schema';
