-- Un code de connexion ne doit pas pouvoir réinitialiser un mot de passe.
--
-- ── POURQUOI CETTE COLONNE ──────────────────────────────────────────────────
--
-- `codes_connexion` sert au code à six chiffres de la connexion. La
-- réinitialisation de mot de passe emprunte la même mécanique — condensat,
-- expiration à 10 minutes, 5 tentatives, 5 demandes par heure — et il serait
-- tentant de réutiliser la table telle quelle.
--
-- Ce serait une porte ouverte. Sans distinction d'usage, un code obtenu dans
-- un contexte vaut dans l'autre : quelqu'un qui se fait dicter son code de
-- connexion au téléphone — par un faux support, ou par un vrai à qui on le lit
-- spontanément — donnerait du même coup le pouvoir de changer son mot de
-- passe. Les deux gestes n'ont pas la même conséquence : l'un ouvre une
-- session, l'autre reprend le compte.
--
-- ── LA VALEUR PAR DÉFAUT EST 'connexion' ────────────────────────────────────
--
-- Les lignes existantes sont toutes des codes de connexion : c'était le seul
-- usage jusqu'ici. Le défaut les qualifie correctement sans les réécrire, et
-- une insertion qui oublierait la colonne retombe sur l'usage le moins
-- puissant — jamais sur celui qui reprend le compte.

ALTER TABLE codes_connexion
  ADD COLUMN IF NOT EXISTS usage TEXT NOT NULL DEFAULT 'connexion';

ALTER TABLE codes_connexion
  DROP CONSTRAINT IF EXISTS codes_connexion_usage_check;

ALTER TABLE codes_connexion
  ADD CONSTRAINT codes_connexion_usage_check
  CHECK (usage IN ('connexion', 'reinitialisation'));

-- Les recherches se font toujours par (utilisateur, usage, non consommé).
CREATE INDEX IF NOT EXISTS codes_connexion_user_usage_idx
  ON codes_connexion (user_id, usage)
  WHERE used_at IS NULL;
