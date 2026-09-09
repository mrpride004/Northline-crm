-- Trailblazer CRM — v44:
-- 1. Lets admins restrict which staff can see/claim new UNASSIGNED orders
--    that arrive automatically from a specific WordPress landing page.
--    Mirrors the existing commission_rules.eligible_staff pattern.
--    Default (null/empty) = unchanged behavior: any staff can see it.
-- 2. Defensive: nothing schema-breaking, purely additive.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table landing_page_sources add column if not exists eligible_staff uuid[];

drop policy if exists "orders_select" on orders;
create policy "orders_select" on orders for select using (
  is_admin()
  or staff_id = auth.uid()
  or dispatch_id = auth.uid()
  or created_by = auth.uid()
  or (
    staff_id is null
    and exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'staff')
    and (
      landing_page_source_id is null
      or not exists (
        select 1 from landing_page_sources lps
        where lps.id = orders.landing_page_source_id
          and lps.eligible_staff is not null and array_length(lps.eligible_staff, 1) > 0
      )
      or exists (
        select 1 from landing_page_sources lps
        where lps.id = orders.landing_page_source_id and auth.uid() = any(lps.eligible_staff)
      )
    )
  )
);

drop policy if exists "orders_update" on orders;
create policy "orders_update" on orders for update using (
  is_admin()
  or staff_id = auth.uid()
  or dispatch_id = auth.uid()
  or (
    staff_id is null
    and exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'staff')
    and (
      landing_page_source_id is null
      or not exists (
        select 1 from landing_page_sources lps
        where lps.id = orders.landing_page_source_id
          and lps.eligible_staff is not null and array_length(lps.eligible_staff, 1) > 0
      )
      or exists (
        select 1 from landing_page_sources lps
        where lps.id = orders.landing_page_source_id and auth.uid() = any(lps.eligible_staff)
      )
    )
  )
);

NOTIFY pgrst, 'reload schema';
