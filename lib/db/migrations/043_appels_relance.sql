-- Migration 043 — appels de relance passés (ticket 4.18, US-5/US-6/US-8)
--
-- Une ligne par TENTATIVE, pas par débiteur : la politique de rappel
-- (`maxTentatives`) ne se compte pas autrement, et l'US-5 demande de savoir
-- après combien d'essais un débiteur a été déclaré injoignable.
--
-- ── Ce que cette table contient de NOMINATIF, et ce qu'elle n'a pas ────────
-- Elle porte une transcription : c'est la donnée la plus sensible de tout le
-- produit après le contenu des messages. Elle NE PORTE PAS d'audio, et il n'y
-- a pas de colonne pour en mettre — le §6 du ticket tranche « transcription
-- seule, pas de conservation d'audio », cohérent avec le devis dicté. Une
-- colonne absente est une garantie plus solide qu'une consigne.
--
-- ── L'effacement, ici et pas plus tard ────────────────────────────────────
-- C'est la migration qui introduit les premières transcriptions du produit.
-- L'US-8 exige que « effacer le contact efface ses appels, transcriptions,
-- promesses dérivées ». La fonction d'effacement arrive donc DANS le même lot,
-- et son test le prouve. Créer la table sans le chemin d'effacement
-- reviendrait à accumuler de la donnée nominative en promettant de savoir la
-- supprimer un jour.
--
-- `empreinte_numero` permet d'effacer sur la coordonnée quand le client a
-- disparu : l'appel survit à la ligne `clients`, comme l'opposition survit au
-- réimport d'un fichier (voir `oppositions`, même doctrine — c'est la personne
-- qu'on vise, pas la ligne).

CREATE TABLE IF NOT EXISTS appels_relance (
  id                  TEXT        PRIMARY KEY,
  tenant_id           UUID        NOT NULL REFERENCES tenants(id),
  campagne_id         TEXT        NOT NULL REFERENCES campagnes_relance(id),

  -- Nullable : un client peut avoir été supprimé entre-temps, et l'appel doit
  -- rester comptable. Le rattachement durable est l'empreinte ci-dessous.
  client_id           TEXT,
  facture_id          TEXT,
  -- Empreinte SALÉE du numéro, jamais le numéro en clair : elle sert à
  -- rapprocher un appel d'une opposition, et à effacer sur la coordonnée.
  empreinte_numero    TEXT        NOT NULL,

  tentative           INTEGER     NOT NULL DEFAULT 1 CHECK (tentative BETWEEN 1 AND 5),

  -- Issue de TRANSPORT (le fournisseur sait si ça a sonné) …
  statut              TEXT        NOT NULL DEFAULT 'PLANIFIE'
                        CHECK (statut IN ('PLANIFIE','EN_COURS','TERMINE','ECHEC')),
  -- … et issue MÉTIER (US-6), qui n'a de sens qu'après une conversation.
  issue               TEXT
                        CHECK (issue IN ('promise','dispute','callback_requested',
                                         'unreachable','refused','paid_claimed')),

  promesse_montant_cents INTEGER,
  -- DATE et non TIMESTAMP : une promesse de paiement est un jour calendaire,
  -- pas un instant. Un timestamptz se décalerait d'un jour selon le fuseau de
  -- lecture — le défaut que `toDateString` évite partout ailleurs.
  promesse_date       DATE,

  transcription       TEXT,
  resume              TEXT,

  -- Coût par appel, pour la facturation à l'usage prévue au pricing v2. En
  -- millièmes de centime : une minute de STT coûte une fraction de centime, et
  -- arrondir au centime rendrait la somme fausse sur un volume.
  cout_millicents     INTEGER     NOT NULL DEFAULT 0,

  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS appels_relance_campagne_idx
  ON appels_relance (tenant_id, campagne_id);
CREATE INDEX IF NOT EXISTS appels_relance_empreinte_idx
  ON appels_relance (tenant_id, empreinte_numero);

ALTER TABLE appels_relance ENABLE ROW LEVEL SECURITY;
ALTER TABLE appels_relance FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON appels_relance;
CREATE POLICY tenant_isolation ON appels_relance
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- PAS append-only, et c'est délibéré : l'effacement RGPD (art. 17) doit
-- pouvoir DELETE ces lignes. Une table de transcriptions qu'on ne pourrait
-- pas effacer serait le contraire de ce que la conformité exige — c'est la
-- différence entre une preuve (journal_decisions, immuable) et une donnée
-- personnelle (celle-ci, effaçable).
