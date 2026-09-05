-- Northline CRM — v13: store email on profiles for display, protect against
-- sending more agent stock than central inventory actually has, and let
-- admins delete a profile row (paired with the new delete-user API route).
-- Run in Supabase: SQL Editor > New query > paste all > Run

-- 1. Store email on the profile for easy display (denormalized, admin-only visible via RLS as before)
alter table profiles add column if not exists email text;

-- 2. Admins can delete profile rows (used when removing a team member)
drop policy if exists "profiles_admin_delete" on profiles;
create policy "profiles_admin_delete" on profiles for delete using (is_admin());

-- 3. send_stock_to_agent now refuses if central inventory doesn't have enough
create or replace function send_stock_to_agent(p_agent_id uuid, p_product_id uuid, p_amount integer)
returns void as $$
declare
  current_stock integer;
begin
  if not is_admin() then
    raise exception 'Only admins can send stock to an agent';
  end if;
  select stock_quantity into current_stock from products where id = p_product_id;
  if current_stock is null or current_stock < p_amount then
    raise exception 'Not enough stock in central inventory (have %, tried to send %)', coalesce(current_stock, 0), p_amount;
  end if;
  update products set stock_quantity = stock_quantity - p_amount where id = p_product_id;
  insert into agent_stock (agent_id, product_id, quantity)
  values (p_agent_id, p_product_id, greatest(0, p_amount))
  on conflict (agent_id, product_id) do update
    set quantity = greatest(0, agent_stock.quantity + p_amount), updated_at = now();
  insert into stock_movements (product_id, agent_id, delta, reason, actor_id)
  values (p_product_id, p_agent_id, -p_amount, 'sent_to_agent', auth.uid());
  insert into stock_movements (product_id, agent_id, delta, reason, actor_id)
  values (p_product_id, p_agent_id, p_amount, 'received_by_agent', auth.uid());
end;
$$ language plpgsql security definer;
grant execute on function send_stock_to_agent(uuid, uuid, integer) to authenticated;

NOTIFY pgrst, 'reload schema';
