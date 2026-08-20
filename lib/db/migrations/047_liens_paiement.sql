-- Migration 047 — liens de paiement (ticket 4.19, lot A)
--
-- « Oui oui je vais payer » ne vaut rien. Cette table trace les liens de
-- paiement émis à la suite d'un appel de relance : la promesse verbale reste
-- une promesse, le lien la rend exécutable dans la minute.
--
-- ── Ce que cette table N'EST PAS ──────────────────────────────────────────
-- Ce n'est pas un journal de paiements. L'encaissement s'écrit dans
-- `paiements` (append-only, tenu par le moteur) au retour du webhook Bridge.
-- Ici on trace l'ÉMISSION du lien et son statut de vie — deux choses
-- différentes : un lien émis n'est pas un euro reçu, et confondre les deux
-- ferait apparaître comme encaissé ce qui n'est qu'espéré.
--
-- ── Aucune coordonnée en clair ────────────────────────────────────────────
-- Le SMS part vers le numéro de l'appel ; on ne le recopie pas ici. Comme
-- `appels_relance`, la table porte l'EMPREINTE salée — assez pour rapprocher
-- et pour effacer sur la coordonnée (US-8), jamais assez pour composer.
--
-- ── L'URL, elle, est stockée ──────────────────────────────────────────────
-- C'est une URL Bridge à usage unique, sans donnée nominative dans le chemin,
-- et le dirigeant doit pouvoir la renvoyer sans regénérer un lien. Elle est
-- volumineuse : `liens_paiement` n'est donc JAMAIS listée par une route qui
-- projette `select()` sans colonnes — même doctrine que `archived_pdfs`.

CREATE TABLE IF NOT EXISTS liens_paiement (
  id                  TEXT        PRIMARY KEY,
  tenant_id           UUID        NOT NULL REFERENCES tenants(id),

  -- L'appel d'origine, quand le lien naît d'une relance vocale. Nullable :
  -- le même mécanisme servira depuis une facture, sans appel.
  appel_id            TEXT        REFERENCES appels_relance(id),
  facture_id          TEXT,
  client_id           TEXT,
  -- Empreinte SALÉE du destinataire du SMS — jamais le numéro en clair.
  empreinte_numero    TEXT        NOT NULL,

  -- Le montant demandé, FIGÉ à l'émission. Il vient de la facture ou de la
  -- promesse enregistrée, jamais du modèle (règle 3). Le relire depuis la
  -- facture au moment du paiement laisserait un lien changer de montant
  -- entre son envoi et son règlement.
  montant_cents       INTEGER     NOT NULL CHECK (montant_cents > 0),

  -- Côté Bridge : l'identifiant du payment link et son URL publique.
  bridge_link_id      TEXT,
  url                 TEXT,

  -- EMIS       : créé chez Bridge, SMS envoyé
  -- PAYE        : le webhook Bridge a confirmé l'exécution
  -- EXPIRE      : la date d'expiration est passée sans paiement
  -- REVOQUE     : annulé par le dirigeant
  -- ECHEC       : Bridge a refusé la création (aucun SMS parti)
  statut              TEXT        NOT NULL DEFAULT 'EMIS'
                        CHECK (statut IN ('EMIS','PAYE','EXPIRE','REVOQUE','ECHEC')),

  expire_le           TIMESTAMPTZ,
  paye_le             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS liens_paiement_tenant_idx
  ON liens_paiement (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS liens_paiement_appel_idx
  ON liens_paiement (tenant_id, appel_id);
CREATE INDEX IF NOT EXISTS liens_paiement_empreinte_idx
  ON liens_paiement (tenant_id, empreinte_numero);

-- Le webhook Bridge ne connaît que l'identifiant du lien : l'index sert la
-- policy de rapprochement (lot D), quatrième usage du patron œuf-et-poule.
CREATE UNIQUE INDEX IF NOT EXISTS liens_paiement_bridge_id_idx
  ON liens_paiement (bridge_link_id) WHERE bridge_link_id IS NOT NULL;

ALTER TABLE liens_paiement ENABLE ROW LEVEL SECURITY;
ALTER TABLE liens_paiement FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON liens_paiement;
CREATE POLICY tenant_isolation ON liens_paiement
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Effaçable comme `appels_relance` : un lien de paiement rattaché à une
-- personne est une donnée personnelle, pas une preuve comptable. La preuve,
-- c'est l'écriture dans `paiements` — elle, immuable.
