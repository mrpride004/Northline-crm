-- Trailblazer CRM — v45: standard/upsell commission rules can now target a
-- Product Set directly, not just an individual product. Before this, any
-- order whose product_id was null (i.e. every set-based order) silently
-- earned zero standard commission, because commission_rules only ever
-- matched on product_id. Mirrors the product_id column exactly.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table commission_rules add column if not exists set_id uuid references product_sets(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'commission_rules_set_id_key'
  ) then
    alter table commission_rules add constraint commission_rules_set_id_key unique (set_id);
  end if;
end $$;

NOTIFY pgrst, 'reload schema';
