-- Migration 048 — webhook de paiement Bridge (ticket 4.19, lot D)
--
-- ── La résolution œuf-et-poule, une QUATRIÈME fois ─────────────────────────
-- Le webhook ne connaît que la référence qu'on a nous-mêmes envoyée à Bridge
-- (`client_reference` = l'identifiant de la ligne `liens_paiement`) : ni
-- tenant, ni session. Même patron que `devis_public_token_lookup` (014),
-- `bank_connections_webhook_lookup` (034) et `appels_relance_webhook_lookup`
-- (046) : une policy étroite laisse app_user lire LA ligne dont l'identifiant
-- correspond au réglage de session, posé dans la transaction. Le tenant_id est
-- LU depuis la ligne — jamais reçu — puis toute écriture repasse par
-- withTenant.

DROP POLICY IF EXISTS liens_paiement_webhook_lookup ON liens_paiement;

CREATE POLICY liens_paiement_webhook_lookup ON liens_paiement
  FOR SELECT TO app_user
  USING (id = current_setting('app.paiement_lien_id', true));

-- ── Ce que le webhook rapporte ────────────────────────────────────────────
--
-- L'identifiant de transaction de Bridge. Il sert à l'IDEMPOTENCE : leur
-- webhook peut rejouer le même événement, et `paiements` est append-only —
-- un doublon y écrirait un second encaissement qui n'a jamais eu lieu. Une
-- colonne UNIQUE est une garantie du moteur, pas une intention du code.
ALTER TABLE liens_paiement
  ADD COLUMN IF NOT EXISTS bridge_transaction_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS liens_paiement_transaction_idx
  ON liens_paiement (bridge_transaction_id) WHERE bridge_transaction_id IS NOT NULL;
