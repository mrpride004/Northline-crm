-- Trailblazer CRM — v42: per-source field mapping. Different landing pages
-- (and different form plugins) send wildly different raw field names —
-- Fluent Forms auto-generates names like input_text, names.first_name,
-- dropdown, description, input_radio2 that vary form to form. Rather than
-- hardcode one form's field names into the shared intake API, each source
-- now stores its own mapping of "CRM field" -> "raw path in the payload".
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table landing_page_sources add column if not exists field_mapping jsonb not null default '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
