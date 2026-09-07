-- Trailblazer CRM — v32: Dispatch can no longer see detailed order data
-- older than 30 days, while their lifetime performance stats (total
-- delivered, success rate, etc.) remain fully intact and accurate.
--
-- This uses a RESTRICTIVE policy rather than modifying your existing
-- SELECT policy on orders. Restrictive policies are AND'ed on top of
-- whatever permissive policies already grant access — they can only take
-- access away, never grant it — so this is safe to add without needing to
-- know or touch your current policy text, and it cannot accidentally lock
-- out admin, staff, or any other role.
-- Run in Supabase: SQL Editor > New query > paste all > Run

drop policy if exists "orders_dispatch_30day_restriction" on orders;
create policy "orders_dispatch_30day_restriction" on orders
as restrictive
for select
using (
  not (
    dispatch_id = auth.uid()
    and exists (select 1 from profiles where id = auth.uid() and role = 'dispatch')
  )
  or created_at >= now() - interval '30 days'
);

create or replace function my_dispatch_lifetime_stats()
returns table (
  total_assigned bigint,
  total_delivered bigint,
  total_cancelled bigint,
  total_active bigint
) as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'dispatch') then
    raise exception 'Only dispatch users can call this';
  end if;
  return query
  select
    count(*) filter (where dispatch_id = auth.uid()),
    count(*) filter (where dispatch_id = auth.uid() and status = 'Delivered'),
    count(*) filter (where dispatch_id = auth.uid() and status = 'Cancelled'),
    count(*) filter (where dispatch_id = auth.uid() and status not in ('Delivered', 'Cancelled'))
  from orders;
end;
$$ language plpgsql security definer;

grant execute on function my_dispatch_lifetime_stats() to authenticated;

NOTIFY pgrst, 'reload schema';
