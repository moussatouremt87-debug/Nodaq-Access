-- Webhook post-call de la plateforme vocale — ticket 4.18-bis, lot D.
--
-- ── La résolution œuf-et-poule, une troisième fois ──────────────────────────
-- Le webhook ne connaît QUE le conversation_id de la plateforme : ni tenant, ni
-- session. Même patron que `devis_public_token_lookup` (014) et
-- `bank_connections_webhook_lookup` (034) : une policy étroite laisse app_user
-- lire LA ligne dont le conversation_id correspond au réglage de session, posé
-- dans la transaction. Le tenant_id est LU depuis la ligne — jamais reçu — puis
-- toute écriture repasse par withTenant.

DROP POLICY IF EXISTS appels_relance_webhook_lookup ON appels_relance;

CREATE POLICY appels_relance_webhook_lookup ON appels_relance
  FOR SELECT TO app_user
  USING (
    conversation_id IS NOT NULL
    AND conversation_id = current_setting('app.voice_conversation_id', true)
  );

-- ── Ce que le webhook rapporte ──────────────────────────────────────────────

-- Durée réelle de la conversation : l'assiette de la tarification à l'usage
-- (pricing v2), et la seule mesure fiable — la plateforme la connaît, nous non.
ALTER TABLE appels_relance
  ADD COLUMN IF NOT EXISTS duree_secondes INTEGER;

-- L'audit du transcript (ADR 005) : depuis le pivot, la garde de pré-parole
-- n'existe plus — on vérifie APRÈS coup ce que l'agent a réellement dit
-- (registres interdits, tutoiement, identité). NULL = pas encore audité ;
-- `{"anomalies": []}` = audité et propre. La différence compte : un appel sans
-- audit n'est pas un appel propre.
ALTER TABLE appels_relance
  ADD COLUMN IF NOT EXISTS audit_transcript JSONB;
