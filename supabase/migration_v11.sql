-- Northline CRM — v11: general-purpose stock adjustment (add or subtract) for
-- both central inventory and agent-held stock. Needed so delivering an order
-- decrements an agent's own stock too, and so cancelling a delivered order
-- can add stock back.
-- Run in Supabase: SQL Editor > New query > paste all > Run

create or replace function adjust_stock(p_product_id uuid, p_delta integer)
returns void as $$
begin
  update products set stock_quantity = greatest(0, stock_quantity + p_delta) where id = p_product_id;
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
end;
$$ language plpgsql security definer;
grant execute on function adjust_agent_stock(uuid, uuid, integer) to authenticated;

NOTIFY pgrst, 'reload schema';
