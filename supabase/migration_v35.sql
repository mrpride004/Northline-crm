-- Trailblazer CRM — v35: link notification messages back to the upsell that
-- triggered them, so admin can see exactly who was notified about a package
-- change and whether they've actually opened/read it — not just that a push
-- notification was fired into the void.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table messages add column if not exists related_upsell_id uuid references upsells(id) on delete set null;

NOTIFY pgrst, 'reload schema';
