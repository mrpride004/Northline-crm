-- Northline CRM — v5 upgrade: track each order's delivery state so you can
-- pick the right agent when a state has more than one dispatch partner.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table orders add column if not exists state text;
