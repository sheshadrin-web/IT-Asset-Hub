-- ════════════════════════════════════════════════════════════════════════════
-- 010_location_grants.sql
-- Fix: the tables created in 008 (user_location_access, asset_shortage_requests,
-- asset_return_requests) had RLS enabled but never received table-level GRANTs
-- for the `authenticated` role. In Supabase, tables created via raw SQL do NOT
-- inherit DML grants automatically, so `authenticated` was left with only
-- REFERENCES/TRIGGER/TRUNCATE — no SELECT/INSERT/UPDATE/DELETE.
--
-- Symptom: any query whose RLS policy subqueries user_location_access (the
-- shortage/return SELECT policies do), or any direct read of the table, failed
-- with "permission denied for table user_location_access" — surfacing on the
-- dashboard as "Failed to load tickets".
--
-- This grants the same DML the existing tables (assets, tickets) already expose
-- to `authenticated`; RLS policies from 008/009 still enforce row scoping.
-- PURELY ADDITIVE. anon intentionally gets nothing (matches existing tables).
-- ════════════════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_location_access    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_shortage_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_return_requests   TO authenticated;

-- SECURITY DEFINER RPC for scoped condition writes.
GRANT EXECUTE ON FUNCTION public.set_asset_condition(uuid, text, text) TO authenticated;
