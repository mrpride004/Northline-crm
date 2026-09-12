-- Trailblazer CRM — v49: extend live auto-refresh beyond just orders.
--
-- Orders, messages, and notifications already push live updates to every
-- connected browser/tab via Supabase Realtime (see the "orders-live-*"
-- subscription in the dashboard). This adds the rest of the tables that
-- back the dashboard's data — catalog, team, settings, and the new Finance
-- tables — to the realtime publication, so admin changes on one device
-- (a new product, an edited price, a logged expense, a permission change,
-- etc.) show up for everyone else who has the CRM open, without anyone
-- needing to refresh the page.
--
-- Note: Realtime respects each table's existing RLS policies per
-- subscriber, so this doesn't loosen who can see what — an admin-only
-- table like product_costs or expenses still only pushes to admins.
--
-- Already applied directly to production via the Supabase MCP connection.
-- Kept here as the source-of-truth record of the schema change.

alter publication supabase_realtime add table
  products,
  product_sets,
  product_set_items,
  product_packages,
  profiles,
  agent_stock,
  app_settings,
  dispatch_companies,
  role_permission_defaults,
  upsells,
  expenses,
  product_costs,
  commission_ledger;
