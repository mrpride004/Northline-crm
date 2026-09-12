-- Trailblazer CRM — v53: add the "Failed Delivery" order status.
--
-- Context: a real delivery attempt that didn't go through (customer
-- unavailable, refused at the door, wrong address, etc.) is different from
-- "Cancelled" (never went out) and needs its own tracking so admin can see
-- failure patterns and dispatch can still log a fee for the attempt.
--
-- Only admin/dispatch can ever set this status in the app UI (enforced in
-- code, not RLS) — staff can see it once set, but never select it themselves.
--
-- Already applied directly to production via the Supabase MCP connection.
-- Kept here as the source-of-truth record of the schema change.

alter table orders drop constraint if exists orders_status_check;

alter table orders add constraint orders_status_check
  check (status = ANY (ARRAY[
    'New'::text, 'Confirmed'::text, 'Preparing'::text, 'Dispatched'::text,
    'Delivered'::text, 'Unreachable'::text, 'Unverified'::text,
    'Rescheduled'::text, 'Failed Delivery'::text, 'Cancelled'::text
  ]));
