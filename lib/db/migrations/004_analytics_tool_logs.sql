-- Migration 004 — analytics_tool_logs
-- Spec §16 : journal des appels à get_indicateur.
-- Aucune valeur, aucune question, aucune réponse n'est stockée.

CREATE TABLE IF NOT EXISTS analytics_tool_logs (
  id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id        uuid        NOT NULL REFERENCES tenants(id),
  indicateur_id    text        NOT NULL,
  periode_debut    date,
  periode_fin      date,
  comparaison_mode text,
  duration_ms      integer     NOT NULL DEFAULT 0,
  -- 'ok' | 'insuffisantes' | 'erreur'
  status           text        NOT NULL
    CHECK (status IN ('ok', 'insuffisantes', 'erreur')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_tool_logs_tenant_created
  ON analytics_tool_logs (tenant_id, created_at DESC);

-- Row-level security
ALTER TABLE analytics_tool_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON analytics_tool_logs;
CREATE POLICY tenant_isolation ON analytics_tool_logs
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

GRANT SELECT, INSERT ON analytics_tool_logs TO app_user;
