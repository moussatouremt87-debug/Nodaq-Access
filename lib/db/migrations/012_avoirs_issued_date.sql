-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012 — date métier d'émission des avoirs
--
-- (Le numéro 011 est pris par 011_objectifs_franchissements.sql, livrée avec le
-- lot 4. Une migration livrée ne se renomme jamais.)
--
-- `avoirs` ne portait que `created_at`, qui est un INSTANT. Comparer un
-- timestamptz à une borne d'exercice réintroduit exactement le défaut de fuseau
-- que ce dépôt a corrigé partout ailleurs : un avoir émis le 31 décembre à 23 h
-- à Paris tombe sur l'exercice SUIVANT une fois converti en UTC, et vient
-- diminuer le chiffre d'affaires de la mauvaise année.
--
-- Le rétro-remplissage convertit en Europe/Paris et non en UTC : les
-- utilisateurs sont des entreprises françaises, et c'est le fuseau que le
-- produit fixe partout (TZ=Europe/Paris dans le Dockerfile et vitest.config).
-- Convertir en UTC déplacerait rétroactivement des avoirs de fin d'année.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE avoirs ADD COLUMN IF NOT EXISTS issued_date DATE;

-- Rétro-remplissage des lignes existantes, en heure de Paris.
UPDATE avoirs
   SET issued_date = (created_at AT TIME ZONE 'Europe/Paris')::date
 WHERE issued_date IS NULL;

-- NOT NULL seulement après remplissage : sur une base vide comme sur une base
-- chargée, l'ordre garantit que l'ALTER ne peut pas échouer.
ALTER TABLE avoirs ALTER COLUMN issued_date SET NOT NULL;

-- Les agrégations de chiffre d'affaires filtrent sur cette colonne.
CREATE INDEX IF NOT EXISTS avoirs_tenant_issued_date_idx
  ON avoirs (tenant_id, issued_date);
