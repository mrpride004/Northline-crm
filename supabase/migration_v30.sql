-- Trailblazer CRM — v30: sequential serial order numbers. Postgres's
-- bigserial handles concurrent inserts safely (each gets a unique,
-- never-reused, always-increasing number) — no risk of duplicates or
-- collisions even with multiple people creating orders at once.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table orders add column if not exists serial_number bigserial;

-- Backfill existing orders in creation order so old orders get sensible
-- (earlier) numbers relative to newer ones.
do $$
declare
  r record;
  n bigint := 0;
begin
  for r in select id from orders order by created_at asc loop
    n := n + 1;
    update orders set serial_number = n where id = r.id and serial_number is distinct from n;
  end loop;
  -- Make sure the sequence continues after the highest backfilled number,
  -- so the next brand-new order doesn't collide with a backfilled one.
  perform setval(pg_get_serial_sequence('orders', 'serial_number'), greatest(n, 1));
end $$;

create unique index if not exists orders_serial_number_idx on orders(serial_number);

NOTIFY pgrst, 'reload schema';
