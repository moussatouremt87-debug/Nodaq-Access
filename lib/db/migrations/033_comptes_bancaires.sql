-- Migration 033 — connecteur bancaire (Bridge, ex-Bankin')
--
-- Socle du bloc « Trésorerie disponible » du cockpit, aujourd'hui codé en
-- dur à NULL (routes/cockpit.ts) faute de toute donnée bancaire réelle.
-- Préalable à US-A3.5 (prévisionnel de trésorerie), qui a besoin d'un solde
-- de départ réel avant de pouvoir projeter quoi que ce soit.
--
-- Deux tables, sur le même principe que pa_transmissions (031) : mutables,
-- pas append-only — un solde bancaire est un instantané courant, pas un
-- historique à conserver ligne par ligne.
--
-- `bank_connections` : une ligne par tenant (au plus une connexion Bridge
-- gérée par cet écran pour ce lot — Bridge modélise plusieurs "items" par
-- utilisateur, mais un seul écran de connexion suffit ici). `bridge_user_uuid`
-- et `bridge_item_id` ne sont PAS des secrets : inutilisables sans le
-- Client-Secret plateforme (BRIDGE_CLIENT_SECRET, protégé en variable
-- d'environnement, jamais en base) — voir lib/banque-agreee.
--
-- `bank_accounts` : un compte bancaire par ligne, solde mis à jour par le
-- webhook Bridge (item.account.created / item.account.updated).

CREATE TABLE IF NOT EXISTS bank_connections (
  id                TEXT        PRIMARY KEY,
  tenant_id         UUID        NOT NULL REFERENCES tenants(id),
  bridge_user_uuid  TEXT        NOT NULL,
  bridge_item_id    TEXT,
  statut            TEXT        NOT NULL DEFAULT 'en_attente'
                                CHECK (statut IN ('en_attente', 'connecte', 'erreur', 'deconnecte')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_connections_unique_tenant UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id             TEXT        PRIMARY KEY,
  tenant_id      UUID        NOT NULL REFERENCES tenants(id),
  connection_id  TEXT        NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  label          TEXT        NOT NULL,
  balance_cents  INTEGER     NOT NULL,
  devise         TEXT        NOT NULL DEFAULT 'EUR',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_accounts_tenant_idx ON bank_accounts (tenant_id);

ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_connections FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bank_connections;
CREATE POLICY tenant_isolation ON bank_connections
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bank_accounts;
CREATE POLICY tenant_isolation ON bank_accounts
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);
