-- Trailblazer CRM — v51: a "test order" flag so future testing never mixes
-- into real numbers again.
--
-- Context: right before going live, ~73 leftover test orders (created while
-- testing the CRM — repeated fake customer names on a handful of the admin's
-- own phone numbers) had built up alongside real orders, including some
-- already marked "Delivered" (affecting stock counts) and generating
-- commission ledger entries. Those were identified and removed by hand.
-- This migration adds a permanent, lightweight way to avoid a repeat: admins
-- can mark an order as a test order at creation (or later, by editing it),
-- and it's automatically excluded from every report and financial
-- calculation while remaining fully visible in the regular order list so it
-- can still be reviewed, edited, or deleted normally.
--
-- Already applied directly to production via the Supabase MCP connection.
-- Kept here as the source-of-truth record of the schema change.

alter table orders add column if not exists is_test boolean not null default false;
comment on column orders.is_test is 'Marks an order as test/demo data. Test orders are excluded from Reports, Daily Summary, Commission, and Finance/Profitability calculations, but remain fully visible and manageable in the regular order list so they can be reviewed or deleted.';
