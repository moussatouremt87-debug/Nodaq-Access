-- Migration 005 — analytics_tool_logs : FORCE ROW LEVEL SECURITY
--
-- La migration 004 active RLS sur analytics_tool_logs mais oublie FORCE.
-- Sans FORCE, le propriétaire de la table contourne les policies : l'isolation
-- n'est pas scellée pour ce rôle. Toutes les autres tables métier ont ENABLE
-- + FORCE (voir 002_rls.sql, ligne 76).
--
-- Idempotent : ALTER TABLE ... FORCE peut être rejoué sans effet de bord.

ALTER TABLE analytics_tool_logs FORCE ROW LEVEL SECURITY;
