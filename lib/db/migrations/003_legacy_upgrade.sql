-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003 — Superseded; intentional no-op
--
-- The column additions originally planned here were moved to 002_columns.sql
-- so they run BEFORE 002_rls.sql enables RLS policies that reference tenant_id.
-- This file is retained to keep the _migrations record consistent for databases
-- that applied it before the reordering.
-- ─────────────────────────────────────────────────────────────────────────────

-- Intentional no-op: all work done in 002_columns.sql.
SELECT 1;
