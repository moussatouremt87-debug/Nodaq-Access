-- Jeton de service du worker vocal — ticket 4.18, lot 6.
--
-- ── Le problème ────────────────────────────────────────────────────────────
-- Le worker vocal est une MACHINE : il n'a pas de session, et les routes qu'il
-- doit appeler (mandat, formulation) sont montées sur `biz`. Il faut donc une
-- authentification de service.
--
-- Un jeton de service unique aurait authentifié la machine — mais le tenant
-- serait alors venu du CORPS de la requête, c'est-à-dire du client. C'est
-- exactement ce que la règle 1 du CLAUDE.md interdit, et sur la donnée la plus
-- sensible du produit : à qui appartient l'appel en cours.
--
-- ── La réponse : un jeton par APPEL, pas par service ───────────────────────
-- Le serveur frappe un jeton lié à UNE ligne de `appels_relance`. La policy
-- ci-dessous laisse `app_user` lire cette ligne — et elle seule — quand le
-- réglage de session correspond au condensat. Le `tenant_id` de l'appel est
-- donc LU, jamais reçu.
--
-- Trois propriétés tombent gratuitement :
--   * le tenant ne peut pas être forgé, puisqu'il n'est jamais transmis ;
--   * la portée est l'appel, pas le compte : un jeton fuité n'ouvre qu'une
--     conversation, pas le portefeuille du tenant ;
--   * la révocation est naturelle — le jeton cesse de valoir quand l'appel
--     quitte `PLANIFIE`/`EN_COURS`, sans liste noire à tenir.
--
-- ── Même motif que l'existant, délibérément ────────────────────────────────
-- C'est la résolution œuf-et-poule déjà employée par `devis_public_token_lookup`
-- (acceptation publique, migration 014) et `bank_connections_webhook_lookup`
-- (webhook bancaire, migration 034) : poser un réglage que SEULE cette policy
-- sait lire, avant tout contexte de tenant normal. Rien de neuf à réviser.
--
-- ── Condensat, jamais le jeton ─────────────────────────────────────────────
-- Seul le SHA-256 entre en base. Le jeton lui-même ne vit que dans ce qu'on
-- remet au worker au moment de composer. Qui lit une sauvegarde ou un réplica
-- ne peut pas se faire passer pour un appel en cours.

ALTER TABLE appels_relance
  ADD COLUMN IF NOT EXISTS jeton_sha256 TEXT;

-- Un condensat ne vaut que pour un appel. L'index UNIQUE le garantit et sert
-- la recherche de la policy, qui est le chemin chaud du worker.
CREATE UNIQUE INDEX IF NOT EXISTS appels_relance_jeton_sha256_idx
  ON appels_relance (jeton_sha256)
  WHERE jeton_sha256 IS NOT NULL;

DROP POLICY IF EXISTS appels_relance_worker_lookup ON appels_relance;

CREATE POLICY appels_relance_worker_lookup ON appels_relance
  FOR SELECT TO app_user
  USING (
    jeton_sha256 IS NOT NULL
    AND jeton_sha256 = current_setting('app.voice_call_token_sha256', true)
    -- Le jeton ne vaut que PENDANT l'appel. Un appel terminé, échoué ou dont
    -- la ligne a été effacée pour l'article 17 ne rouvre rien : c'est ce qui
    -- rend la révocation automatique plutôt que déclarative.
    AND statut IN ('PLANIFIE', 'EN_COURS')
  );
