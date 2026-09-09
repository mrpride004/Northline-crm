-- Trailblazer CRM — v41: external order intake from landing pages (via
-- Zapier/Make/Pabbly). Each landing page gets its own API key, tied to a
-- product and (optionally) a mapping of its form's package options to the
-- right package/set in the CRM. Orders that come in this way land as normal
-- "New" orders — same confirm, auto-assign, dispatch, commission pipeline
-- as everything else. No new downstream logic needed; this only adds the
-- front door.
-- Run in Supabase: SQL Editor > New query > paste all > Run

create table if not exists landing_page_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  api_key text not null unique,
  product_id uuid references products(id),
  option_mapping jsonb not null default '{}'::jsonb,
  default_state text,
  active boolean not null default true,
  created_at timestamptz default now(),
  last_used_at timestamptz,
  total_orders_received integer not null default 0
);
alter table landing_page_sources enable row level security;
drop policy if exists "landing_sources_admin_all" on landing_page_sources;
create policy "landing_sources_admin_all" on landing_page_sources for all using (is_admin());

alter table orders add column if not exists landing_page_source_id uuid references landing_page_sources(id);

NOTIFY pgrst, 'reload schema';
