-- L'envoi du brief du matin — une trace par tenant et par jour.
--
-- ── POURQUOI UNE TABLE, ET PAS UN SIMPLE ENVOI ──────────────────────────────
--
-- Le déclencheur du matin est extérieur (un cron Scaleway qui appelle une
-- route). Un déclencheur extérieur peut se répéter : reprise après incident,
-- double instance pendant un déploiement progressif, ou simple relance
-- manuelle. Sans garde, l'artisan reçoit deux fois le même message — et un
-- produit qui écrit deux fois passe pour un produit qui ne se relit pas.
--
-- La contrainte UNIQUE fait la garde à la place du code : deux exécutions
-- concurrentes insèrent, une seule gagne, l'autre ne trouve rien à envoyer.
-- Aucune fenêtre de course à fermer, même patron que `usage_franchissements`
-- et `essai_jalons`.
--
-- Le JOUR est une date métier ('YYYY-MM-DD' en heure de Paris), pas un
-- timestamp : « le brief du 12 septembre » est un jour de calendrier pour
-- l'artisan, pas un instant.
--
-- ── PAS DE CONTENU ICI ──────────────────────────────────────────────────────
--
-- La table garde QUE le fait de l'envoi, jamais le texte. La règle 6 interdit
-- de journaliser un contenu de message, et le brief en est un — il cite des
-- noms de clients et des montants.

CREATE TABLE IF NOT EXISTS briefs_envoyes (
  id          TEXT        PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  jour        TEXT        NOT NULL,
  destinataire TEXT       NOT NULL,
  sections    INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT briefs_envoyes_unique UNIQUE (tenant_id, jour)
);

ALTER TABLE briefs_envoyes ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefs_envoyes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS briefs_envoyes_tenant ON briefs_envoyes;
CREATE POLICY briefs_envoyes_tenant ON briefs_envoyes
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT ON briefs_envoyes TO app_user;
