-- Trailblazer CRM — v50: allow "Unverified" in the orders status check constraint.
--
-- The application code (STATUSES array in app/dashboard/features.js) added a new
-- "Unverified" order status, but the database-level check constraint on
-- orders.status was never updated to match — causing every attempt to set an
-- order to Unverified to fail with:
--   new row for relation "orders" violates check constraint "orders_status_check"
--
-- This drops and recreates the constraint to include 'Unverified' alongside the
-- existing allowed values.
--
-- Already applied directly to production via the Supabase MCP connection.
-- Kept here as the source-of-truth record of the schema change.

alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check check (
  status = ANY (ARRAY[
    'New'::text,
    'Confirmed'::text,
    'Preparing'::text,
    'Dispatched'::text,
    'Delivered'::text,
    'Unreachable'::text,
    'Unverified'::text,
    'Rescheduled'::text,
    'Cancelled'::text
  ])
);
