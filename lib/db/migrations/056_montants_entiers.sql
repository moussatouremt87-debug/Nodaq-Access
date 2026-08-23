-- ═══════════════════════════════════════════════════════════════════════════
-- 056 — Les montants passent du flottant à l'entier
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Le défaut, mesuré ─────────────────────────────────────────────────────
-- Onze colonnes monétaires étaient déclarées `real` — `float4` en PostgreSQL,
-- dont la mantisse de 24 bits ne représente exactement les entiers que jusqu'à
-- 2^24. En centimes, cela plafonne à 167 772,16 €. Au-delà, la valeur relue
-- n'est plus celle qu'on a écrite :
--
--     INSERT 19999999   (199 999,99 €)   →   relu 20000000   (200 000,00 €)
--     INSERT 123456789  (1 234 567,89 €) →   relu 123456792  (1 234 567,92 €)
--
-- Les documents étaient épargnés : le PDF et le XML Factur-X se calculent
-- depuis `lines` (JSON, centimes entiers) et depuis total_ht_cents /
-- total_tva_cents, déjà `integer`. Ce qui était touché, c'est tout ce qui
-- agrège — le total des impayés, le moteur de relance, les indicateurs.
--
-- ── Pourquoi `integer` et non `bigint` ────────────────────────────────────
-- `integer` plafonne à 2 147 483 647 centimes, soit 21 474 836,47 € par ligne.
-- Deux raisons de s'y tenir :
--
--   1. Le marché visé est l'artisan et la TPE de 3 à 15 salariés. Aucune
--      ligne — facture, chantier, contrat — n'approche cet ordre de grandeur.
--      Les SOMMES ne débordent pas non plus : PostgreSQL promeut `sum(int4)`
--      en `bigint` de lui-même.
--
--   2. `bigint` est un piège ici. Le pilote node-postgres rend `int8` sous
--      forme de CHAÎNE, parce que la plage dépasse ce qu'un `number` JS
--      représente exactement. Ce dépôt lit ces colonnes en SQL brut
--      (`routes/avoirs.ts`) : une addition y deviendrait silencieusement une
--      concaténation de chaînes. On échangerait un défaut d'arrondi contre un
--      défaut de type, moins visible encore.
--
-- Le seuil est donc explicite et gardé : `montants-entiers.test.ts` échoue si
-- une colonne monétaire redevient flottante.
--
-- ── Ce que cette migration fait, et dans quel ordre ───────────────────────
--   1. Photographie l'avant dans `migration_056_ecarts`.
--   2. Convertit les onze colonnes, par ROUND() — seul cast possible.
--   3. RECALCULE depuis la source exacte là où il en existe une (factures,
--      affaires). Un ROUND() du flottant ne rend pas la valeur d'origine : il
--      fige l'erreur. Là où aucune source exacte n'existe, le ROUND() reste,
--      et la table d'écarts le dit.
--   4. Pose l'invariant de cohérence sur les factures.
--
-- Le tout dans la transaction que `migrate.mjs` ouvre autour de chaque
-- fichier : ou tout passe, ou rien.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La photographie de l'avant ─────────────────────────────────────────
--
-- Une TABLE et non un fichier : une migration n'écrit pas sur disque, et le
-- disque d'un conteneur est éphémère. Elle reste interrogeable des mois plus
-- tard, ce qu'un journal de déploiement ne permet pas.
--
-- Pas de tenant_id, donc pas de RLS : cette table est un artefact d'exploitation,
-- lu par l'exploitant, jamais par une route métier. `app_user` n'y a aucun
-- droit — voir create-app-role.cjs.
CREATE TABLE IF NOT EXISTS migration_056_ecarts (
  id            bigserial PRIMARY KEY,
  nom_table     text    NOT NULL,
  colonne       text    NOT NULL,
  ligne_id      text    NOT NULL,
  avant_cents   bigint  NOT NULL,
  apres_cents   bigint  NOT NULL,
  origine       text    NOT NULL,   -- 'source_exacte' | 'suspect_au_dela_du_seuil'
  applique_le   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE migration_056_ecarts IS
  'Écarts constatés au passage des montants du flottant à l''entier (migration 056). Une ligne par valeur qui a bougé d''au moins 1 centime.';

-- ── 2. Conversion des onze colonnes ───────────────────────────────────────
--
-- ROUND() avant le cast : sans lui, PostgreSQL tronque, et 19999999.0 stocké
-- en float4 vaut 20000000.0 — la troncature rendrait 20000000 de toute façon,
-- mais sur d'autres valeurs elle perdrait un centime de plus.
ALTER TABLE factures
  ALTER COLUMN amount_cents   TYPE integer USING ROUND(amount_cents)::integer,
  ALTER COLUMN residual_cents TYPE integer USING ROUND(residual_cents)::integer;

ALTER TABLE affaires
  ALTER COLUMN quoted_amount_cents   TYPE integer USING ROUND(quoted_amount_cents)::integer,
  ALTER COLUMN invoiced_amount_cents TYPE integer USING ROUND(invoiced_amount_cents)::integer,
  ALTER COLUMN margin_cents          TYPE integer USING ROUND(margin_cents)::integer,
  ALTER COLUMN montant_vendu_ht      TYPE integer USING ROUND(montant_vendu_ht)::integer;

ALTER TABLE contrats
  ALTER COLUMN amount_cents TYPE integer USING ROUND(amount_cents)::integer;

ALTER TABLE prospects
  ALTER COLUMN estimated_value_cents TYPE integer USING ROUND(estimated_value_cents)::integer;

ALTER TABLE echeances
  ALTER COLUMN estimated_cents TYPE integer USING ROUND(estimated_cents)::integer,
  ALTER COLUMN paid_cents      TYPE integer USING ROUND(paid_cents)::integer;

ALTER TABLE pending_actions
  ALTER COLUMN amount_cents TYPE integer USING ROUND(amount_cents)::integer;

-- ── 3. Recalcul depuis la source exacte ───────────────────────────────────
--
-- Le ROUND() ci-dessus fige l'erreur au lieu de la corriger : une facture de
-- 199 999,99 € était déjà devenue 200 000,00 € en base, et l'arrondi la laisse
-- à 200 000,00 €. Là où une source exacte existe, on la relit.

-- 3a. factures.amount_cents — la source exacte est total_ht + total_tva,
--     deux colonnes `integer` depuis toujours.
--
--     Exception : les lignes de REPRISE (import d'impayés) portent un TTC dont
--     personne ne connaît la ventilation HT/TVA. Elles ont total_ht = 0 et
--     total_tva = 0 ; les recalculer les mettrait à zéro et effacerait la
--     créance. On les laisse à leur valeur arrondie.
INSERT INTO migration_056_ecarts (nom_table, colonne, ligne_id, avant_cents, apres_cents, origine)
SELECT 'factures', 'amount_cents', id, amount_cents,
       total_ht_cents + total_tva_cents, 'source_exacte'
FROM factures
WHERE NOT (total_ht_cents = 0 AND total_tva_cents = 0)
  AND amount_cents <> total_ht_cents + total_tva_cents;

UPDATE factures
   SET amount_cents = total_ht_cents + total_tva_cents
 WHERE NOT (total_ht_cents = 0 AND total_tva_cents = 0)
   AND amount_cents <> total_ht_cents + total_tva_cents;

-- 3b. factures.residual_cents — la source exacte est le journal des paiements,
--     append-only et déjà en `integer`. Le solde dû, c'est le TTC moins ce qui
--     a été encaissé, plus ce qui a été annulé.
--
--     `paiements.sens` vaut ENCAISSEMENT, REMBOURSEMENT ou ANNULATION ; seul
--     l'encaissement diminue la créance. Un avoir la diminue aussi, mais il
--     porte sa propre écriture — on ne la recalcule donc pas ici, sous peine
--     de la compter deux fois : les factures rattachées à un avoir sont
--     exclues.
-- Le calcul est écrit UNE fois, dans une CTE, et relu par le relevé d'écart
-- comme par la mise à jour : deux copies de cette expression finiraient par
-- diverger, et c'est précisément ce que cette migration corrige ailleurs.
CREATE TEMP TABLE calc_residuel ON COMMIT DROP AS
SELECT f.id,
       GREATEST(0, f.amount_cents - COALESCE((
         SELECT SUM(CASE WHEN p.sens = 'ENCAISSEMENT' THEN p.montant_cents ELSE 0 END)
              - SUM(CASE WHEN p.sens = 'ANNULATION'   THEN p.montant_cents ELSE 0 END)
         FROM paiements p WHERE p.facture_id = f.id
       ), 0))::integer AS reste,
       COALESCE(f.residual_cents, f.amount_cents) AS avant
  FROM factures f
 WHERE f.avoir_id IS NULL;

INSERT INTO migration_056_ecarts (nom_table, colonne, ligne_id, avant_cents, apres_cents, origine)
SELECT 'factures', 'residual_cents', c.id, c.avant, c.reste, 'source_exacte'
  FROM calc_residuel c WHERE c.avant <> c.reste;

UPDATE factures f
   SET residual_cents = c.reste
  FROM calc_residuel c
 WHERE c.id = f.id AND c.avant <> c.reste;

-- 3c. affaires.invoiced_amount_cents — la source exacte est la somme des
--     factures rattachées.
CREATE TEMP TABLE calc_affaires ON COMMIT DROP AS
SELECT a.id,
       COALESCE((SELECT SUM(f.amount_cents) FROM factures f WHERE f.affaire_id = a.id), 0)::integer AS total,
       a.invoiced_amount_cents AS avant
  FROM affaires a
 WHERE a.invoiced_amount_cents IS NOT NULL;

INSERT INTO migration_056_ecarts (nom_table, colonne, ligne_id, avant_cents, apres_cents, origine)
SELECT 'affaires', 'invoiced_amount_cents', c.id, c.avant, c.total, 'source_exacte'
  FROM calc_affaires c WHERE c.avant <> c.total;

UPDATE affaires a
   SET invoiced_amount_cents = c.total
  FROM calc_affaires c
 WHERE c.id = a.id AND c.avant <> c.total;

-- 3d. Les autres colonnes n'ont AUCUNE source exacte : le montant d'un
--     contrat, la valeur estimée d'un prospect, la provision d'une échéance
--     fiscale sont saisis à la main. L'arrondi du flottant est tout ce qu'on
--     a, et la table d'écarts le consigne comme tel — sans quoi on croirait
--     ces valeurs recalculées.
--
--     Le ROUND() de l'étape 2 est déjà appliqué et ne change rien : la valeur
--     avait été faussée à l'ÉCRITURE, pas à la migration. Un contrat saisi à
--     199 999,99 € était déjà relu 200 000,00 € avant qu'on y touche.
--
--     Ces valeurs seraient donc absentes d'un rapport qui ne consigne que ce
--     qui bouge — et le rapport dirait « aucun écart » là où l'argent est
--     faux. On les MARQUE comme suspectes : au-delà de 2^24 centimes, la
--     valeur stockée peut différer de celle qui a été saisie, et l'original
--     n'existe plus nulle part pour trancher.
INSERT INTO migration_056_ecarts (nom_table, colonne, ligne_id, avant_cents, apres_cents, origine)
SELECT 'contrats', 'amount_cents', id, amount_cents, amount_cents, 'suspect_au_dela_du_seuil'
  FROM contrats WHERE amount_cents > 16777216
UNION ALL
SELECT 'prospects', 'estimated_value_cents', id, estimated_value_cents, estimated_value_cents, 'suspect_au_dela_du_seuil'
  FROM prospects WHERE estimated_value_cents > 16777216
UNION ALL
SELECT 'echeances', 'estimated_cents', id, estimated_cents, estimated_cents, 'suspect_au_dela_du_seuil'
  FROM echeances WHERE estimated_cents > 16777216
UNION ALL
SELECT 'echeances', 'paid_cents', id, paid_cents, paid_cents, 'suspect_au_dela_du_seuil'
  FROM echeances WHERE paid_cents > 16777216
UNION ALL
SELECT 'pending_actions', 'amount_cents', id, amount_cents, amount_cents, 'suspect_au_dela_du_seuil'
  FROM pending_actions WHERE amount_cents > 16777216
UNION ALL
SELECT 'affaires', 'quoted_amount_cents', id, quoted_amount_cents, quoted_amount_cents, 'suspect_au_dela_du_seuil'
  FROM affaires WHERE quoted_amount_cents > 16777216
UNION ALL
SELECT 'affaires', 'margin_cents', id, margin_cents, margin_cents, 'suspect_au_dela_du_seuil'
  FROM affaires WHERE margin_cents > 16777216
UNION ALL
SELECT 'affaires', 'montant_vendu_ht', id, montant_vendu_ht, montant_vendu_ht, 'suspect_au_dela_du_seuil'
  FROM affaires WHERE montant_vendu_ht > 16777216;

-- ── 4. L'invariant de cohérence des factures ──────────────────────────────
--
-- Le TTC stocké est soit la somme de sa ventilation, soit une valeur sans
-- ventilation connue (reprise d'impayés). Jamais une troisième chose.
--
-- Cette contrainte est ce qui empêche les deux vérités de diverger à nouveau :
-- un correctif futur qui toucherait l'un sans l'autre serait refusé par le
-- moteur, pas par une revue de code.
ALTER TABLE factures
  ADD CONSTRAINT factures_ttc_coherent
  CHECK (
    amount_cents = total_ht_cents + total_tva_cents
    OR (total_ht_cents = 0 AND total_tva_cents = 0)
  );

COMMENT ON CONSTRAINT factures_ttc_coherent ON factures IS
  'Le TTC est la somme de sa ventilation, ou bien la ventilation est inconnue (reprise d''impayés : un TTC importé sans détail). Jamais une troisième valeur.';
