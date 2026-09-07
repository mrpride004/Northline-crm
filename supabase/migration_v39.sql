-- Trailblazer CRM — v39: package-change/upsell alerts move onto the same
-- unified, persistent notifications system as every other order alert
-- (new order, assignment, status change) — instead of being the one
-- remaining alert type still running on the older, separate path.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table notifications add column if not exists related_upsell_id uuid references upsells(id) on delete set null;

NOTIFY pgrst, 'reload schema';
