-- Trailblazer CRM — v57: fix adjust_stock function-overload ambiguity.
--
-- v56 used `create or replace function` to add trailing parameters
-- (movement_type, order_id, supplier_id, ...) to adjust_stock,
-- adjust_agent_stock, adjust_stock_for_set and adjust_agent_stock_for_set.
-- Postgres only replaces a function when its parameter list matches
-- exactly — since these gained new params, the OLD shorter-signature
-- functions were left behind as separate overloads instead of being
-- replaced. Any call site still using the old (shorter) argument list
-- became ambiguous to PostgREST ("Could not choose the best candidate
-- function", PGRST203) and silently failed with no stock change and no
-- movement logged.
--
-- This affected, live, from the moment v56 was deployed:
--   - deductStockForDelivery (app/dashboard/page.js) — the delivery-
--     confirmation stock deduction used by the dispatch order flow —
--     which still calls adjust_stock / adjust_agent_stock /
--     adjust_stock_for_set / adjust_agent_stock_for_set with only their
--     original arguments.
--   - The manual "Add / subtract quantity" and "Set exact" controls on
--     the Inventory page (adjust_stock with 2 args).
--
-- Verified via stock_movements and orders.status_updated_at that no real
-- order or user action fell inside the affected window (~32 minutes,
-- 2026-09-12 16:06–16:39 UTC) — only this session's own test/cleanup rows
-- did. No production data was corrupted.
--
-- Fix: drop the old, shorter-signature overloads. The remaining (newer)
-- functions default every added parameter, so every existing call site —
-- old short-arg calls and new long-arg calls alike — now resolves to a
-- single, unambiguous function.
--
-- Already applied directly to production via the Supabase MCP connection.
-- Kept here as the source-of-truth record of the schema change.

drop function if exists public.adjust_stock(uuid, integer);
drop function if exists public.adjust_agent_stock(uuid, uuid, integer);
drop function if exists public.adjust_stock_for_set(uuid, integer);
drop function if exists public.adjust_agent_stock_for_set(uuid, uuid, integer);
