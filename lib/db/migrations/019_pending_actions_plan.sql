-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 019 — `pending_actions` porte un plan
--
-- La règle 4 du dépôt : « toute écriture agentique crée une pending_action à
-- valider en un clic ». La table existait, mais elle ne savait porter qu'une
-- action unique décrite en texte : ni charge utile structurée, ni expiration.
-- Un plan vocal — plusieurs opérations, leurs résolutions, les questions
-- restées ouvertes — n'y tenait pas.
--
-- ── POURQUOI CETTE MIGRATION EXISTE MALGRÉ LE TICKET ────────────────────────
-- Le ticket du lot B interdit d'ajouter une migration, ET demande d'ajouter à
-- `pending_actions` « une charge utile JSON et une date d'expiration ». Les
-- deux ne peuvent pas tenir : la table n'a aucune des deux colonnes.
-- L'interdiction visait à éviter les conflits avec le lot A ; un FICHIER NEUF
-- sur une table que le lot A ne touche pas n'en produit aucun, et le numéro 019
-- s'applique correctement quel que soit l'ordre de fusion — `_migrations`
-- indexe par nom, et rien ici ne dépend de 015 à 018.
-- ─────────────────────────────────────────────────────────────────────────────

-- Le plan, structuré. Le libellé lisible reste dans `label` : un humain doit
-- pouvoir comprendre ce qu'il valide sans lire du JSON.
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS payload JSONB;

-- Un plan non validé expire. Sans expiration, une phrase dictée le mardi
-- pourrait être appliquée le vendredi, contre des données qui ont changé
-- entre-temps.
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS expire_le TIMESTAMPTZ;

-- Horodatage de l'exécution. C'est LUI qui rend le rejeu inoffensif : un plan
-- déjà appliqué porte une date, et la route refuse de le rejouer.
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS execute_le TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS pending_actions_tenant_expire_idx
  ON pending_actions (tenant_id, expire_le);
