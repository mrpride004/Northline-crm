-- Trailblazer CRM — v55: product categories + variants (sizes/colors).
--
-- product_categories groups products for organization/reporting (e.g.
-- "Skincare", "Bundles"). products.category_id is a nullable FK — existing
-- products just show as uncategorized until an admin assigns one.
--
-- product_variants lets a product carry size/color combinations, each with
-- its own optional SKU, price override, and stock count. A product with no
-- variant rows behaves exactly as before (sells as a single plain item) —
-- this is additive, not a breaking change to how orders work today. The
-- full inventory subsystem (a later task) will hook real stock movements
-- into variant-level stock_quantity instead of only the product-level one.
--
-- Same RLS shape as the existing products/product_packages tables:
-- everyone signed in can read, only admin can write.
--
-- Already applied directly to production via the Supabase MCP connection.
-- Kept here as the source-of-truth record of the schema change.

create table if not exists product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

alter table product_categories enable row level security;

create policy product_categories_select_all on product_categories
  for select using (auth.uid() is not null);
create policy product_categories_admin_write on product_categories
  for insert with check (is_admin());
create policy product_categories_admin_update on product_categories
  for update using (is_admin());
create policy product_categories_admin_delete on product_categories
  for delete using (is_admin());

alter table products add column if not exists category_id uuid references product_categories(id) on delete set null;

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  size text,
  color text,
  sku text,
  price numeric,
  stock_quantity integer not null default 0,
  active boolean not null default true,
  created_at timestamptz default now()
);

create index if not exists idx_product_variants_product_id on product_variants(product_id);
create unique index if not exists idx_product_variants_sku on product_variants(sku) where sku is not null;

alter table product_variants enable row level security;

create policy product_variants_select_all on product_variants
  for select using (auth.uid() is not null);
create policy product_variants_admin_write on product_variants
  for insert with check (is_admin());
create policy product_variants_admin_update on product_variants
  for update using (is_admin());
create policy product_variants_admin_delete on product_variants
  for delete using (is_admin());
