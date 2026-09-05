-- Northline CRM — v10: safely let staff/dispatch trigger a stock decrease
-- (e.g. when marking an order Delivered) without giving them full
-- update rights on the products table.
-- Run in Supabase: SQL Editor > New query > paste all > Run

create or replace function decrement_stock(p_product_id uuid, p_amount integer)
returns void as $$
begin
  update products
  set stock_quantity = greatest(0, stock_quantity - p_amount)
  where id = p_product_id;
end;
$$ language plpgsql security definer;

grant execute on function decrement_stock(uuid, integer) to authenticated;

NOTIFY pgrst, 'reload schema';
