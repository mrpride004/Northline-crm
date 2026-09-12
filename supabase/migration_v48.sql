-- Trailblazer CRM — v48: unique identifiers (SKU/codes) for products and sets.
--
-- As the catalog grows to many products, sets, and packages, admin needs a
-- short, unique code per sellable item (e.g. "SK-SERUM-30") so staff/dispatch
-- can tell apart similarly-named items at a glance, and so the Profitability
-- report can be organized cleanly by product/set instead of an ever-growing
-- flat list. Optional — admin can leave it blank — but unique when set.
--
-- Already applied directly to production via the Supabase MCP connection.
-- Kept here as the source-of-truth record of the schema change.

alter table products add column if not exists sku text;
alter table product_sets add column if not exists sku text;

-- Partial unique indexes: many rows can have a NULL/blank sku, but any two
-- non-blank codes across the same table must differ.
create unique index if not exists products_sku_unique on products (sku) where sku is not null and sku <> '';
create unique index if not exists product_sets_sku_unique on product_sets (sku) where sku is not null and sku <> '';
