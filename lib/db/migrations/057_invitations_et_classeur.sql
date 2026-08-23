-- ═══════════════════════════════════════════════════════════════════════════
-- 057 — L'état des invitations, et l'indexation des documents au Classeur
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Deux chantiers issus de l'audit du 23/08 (tickets 4.27 et 4.31). Une seule
-- migration parce qu'ils partent ensemble ; rien ne les couple par ailleurs.
--
-- ═══ A — les invitations (ticket 4.27) ═══════════════════════════════════
--
-- Ce qui existait déjà, et que l'audit avait sous-estimé : chaque tentative
-- d'envoi est journalisée dans `envois_journal` (statut, motif d'échec,
-- horodatage), en append-only. La donnée était là ; c'est l'écran qui ne la
-- montrait pas, et il n'y avait ni renvoi, ni moyen de retrouver le lien.
--
-- Il manque UN état que le journal ne peut pas connaître : l'invitation
-- a-t-elle été OUVERTE ? On l'apprend quand le destinataire suit le lien, pas
-- quand on le lui envoie. D'où `opened_at`.
--
-- Pas de pixel de suivi : c'est le chargement de l'invitation par sa route
-- publique qui date l'ouverture. Un pixel piste une lecture d'e-mail à l'insu
-- du destinataire ; ici, l'ouverture est un CLIC délibéré sur un lien qu'on
-- lui a envoyé.
ALTER TABLE tenant_invites
  ADD COLUMN IF NOT EXISTS opened_at timestamptz;

COMMENT ON COLUMN tenant_invites.opened_at IS
  'Premier chargement du lien d''invitation par son destinataire. Daté au clic, jamais par un pixel de suivi. Ne bouge plus ensuite : c''est une première fois, pas un compteur.';

-- Le renvoi remplace le jeton — on ne conserve que son condensat, le lien
-- d'origine est donc irrécupérable. Cette date dit à l'écran qu'un renvoi a
-- eu lieu, et donc que l'ancien lien ne fonctionne plus.
ALTER TABLE tenant_invites
  ADD COLUMN IF NOT EXISTS renvoyee_le timestamptz;

COMMENT ON COLUMN tenant_invites.renvoyee_le IS
  'Dernier renvoi. Un renvoi REMPLACE le jeton (seul son condensat est conservé, le lien d''origine est perdu) : l''ancien lien cesse de fonctionner, et l''écran doit le dire.';

-- ═══ B — l'indexation au Classeur (ticket 4.31 b) ════════════════════════
--
-- Verbatim de la session de test du 22/08, toujours vrai avant cette
-- migration : « j'avais ajouté une facture au tout début mais elle n'apparaît
-- pas dans le classeur ». Seul l'envoi de photo écrivait au Classeur.
--
-- Une entrée de Classeur n'avait aucun moyen de désigner le document dont
-- elle vient. Sans ce lien, l'indexation ne serait ni idempotente — un
-- deuxième appel créerait un doublon — ni réversible.
ALTER TABLE classeur_documents
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id   text;

COMMENT ON COLUMN classeur_documents.source_type IS
  'Le document métier d''où vient cette entrée : FACTURE, DEVIS, AVOIR, CONTRAT. NULL pour un fichier déposé à la main ou envoyé en photo — il n''a pas d''autre existence que celle-ci.';

-- L'idempotence est tenue par le MOTEUR, pas par un « existe déjà ? »
-- applicatif : deux requêtes simultanées liraient « non » toutes les deux.
-- Index PARTIEL — les documents déposés à la main n'ont pas de source, et
-- rien ne doit les empêcher d'être plusieurs.
CREATE UNIQUE INDEX IF NOT EXISTS classeur_source_unique_idx
  ON classeur_documents (tenant_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

-- ── Reprise : les documents déjà créés entrent au Classeur ────────────────
--
-- Rejouable sans dommage grâce à l'index ci-dessus : `ON CONFLICT DO NOTHING`
-- absorbe une seconde exécution. La migration ne sera pas rejouée par
-- `migrate.mjs`, mais le script de reprise, lui, peut l'être.
--
-- La catégorie n'est pas devinée : chaque type a la sienne, fixée ici.
INSERT INTO classeur_documents (id, tenant_id, name, category, mime_type, affaire_id, source_type, source_id, created_at)
SELECT gen_random_uuid()::text, f.tenant_id,
       'Facture ' || f.number, 'FACTURE', 'application/pdf', f.affaire_id, 'FACTURE', f.id, f.created_at
  FROM factures f
ON CONFLICT DO NOTHING;

INSERT INTO classeur_documents (id, tenant_id, name, category, mime_type, affaire_id, source_type, source_id, created_at)
SELECT gen_random_uuid()::text, d.tenant_id,
       'Devis ' || COALESCE(d.reference, d.id), 'DEVIS', 'application/pdf', d.affaire_id, 'DEVIS', d.id, d.created_at
  FROM devis d
ON CONFLICT DO NOTHING;

INSERT INTO classeur_documents (id, tenant_id, name, category, mime_type, affaire_id, source_type, source_id, created_at)
SELECT gen_random_uuid()::text, a.tenant_id,
       'Avoir ' || COALESCE(a.numero, a.id), 'AVOIR', 'application/pdf', NULL, 'AVOIR', a.id, a.created_at
  FROM avoirs a
ON CONFLICT DO NOTHING;

INSERT INTO classeur_documents (id, tenant_id, name, category, mime_type, affaire_id, source_type, source_id, created_at)
SELECT gen_random_uuid()::text, c.tenant_id,
       'Contrat ' || c.label, 'CONTRAT', 'application/pdf', NULL, 'CONTRAT', c.id, c.created_at
  FROM contrats c
ON CONFLICT DO NOTHING;
