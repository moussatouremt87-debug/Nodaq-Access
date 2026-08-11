-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026 — trace durable des incidents de facturation
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  UNE FACTURE PEUT RESTER ANNULÉE PAR UN AVOIR QUI N'EXISTE PAS.          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- `POST /avoirs` procède en deux transactions séparées par la génération du
-- PDF. TX1 réclame la facture (résiduel diminué, statut basculé en
-- ANNULEE_PAR_AVOIR en cas d'annulation totale) et est validée en base AVANT
-- que l'avoir existe. Si TX2 (l'insertion de l'avoir) ou la génération du PDF
-- échoue ensuite, une compensation restaure la facture — mais si CETTE
-- compensation échoue à son tour, ou si le processus meurt entre les deux,
-- rien ne restaure la facture. Elle reste ANNULEE_PAR_AVOIR (ou son résiduel
-- diminué) sans qu'aucun avoir ne corresponde.
--
-- La définition du chiffre d'affaires (lib/chiffreAffaires.ts) compte les
-- factures ANNULEE_PAR_AVOIR à leur valeur PLEINE et retranche les avoirs.
-- Un avoir manquant gonfle donc le CA du montant exact de la facture annulée
-- — sur la jauge qui annonce au patron ce qu'il lui reste à facturer.
--
-- ── CE QU'UNE LIGNE DE JOURNAL NE PROTÈGE PAS ───────────────────────────────
-- L'ancien comportement se contentait de `console.error("manual review
-- required")`. Une ligne dans un conteneur que personne ne lit ne protège de
-- rien : elle disparaît au redémarrage, et rien ne la relie à un écran que
-- quelqu'un consulte. D'où cette table : une trace qui SURVIT au conteneur,
-- lisible par le propriétaire du tenant concerné, avec de quoi réparer sans
-- enquête.
--
-- ── PAS DE FK factures.avoir_id → avoirs.id ─────────────────────────────────
-- Ce serait la réponse structurelle — mais elle imposerait d'insérer l'avoir
-- AVANT de réclamer la facture, donc avant que son PDF existe, ce qui heurte
-- la doctrine du dépôt : aucun document n'est émis sans son PDF archivé
-- (archived_pdfs, CLAUDE.md §5). Le choix mérite d'être reposé un jour, pas
-- dans ce lot.
--
-- ── incidents_facturation.facture_id RÉFÉRENCE bien factures(id) ───────────
-- Contrairement à `factures.avoir_id`, cette référence-ci ne pose pas le
-- problème d'ordre ci-dessus : la facture existe TOUJOURS au moment où
-- l'incident est écrit (c'est elle qui est en cause), donc la FK est sûre et
-- désirable — elle empêche un incident de pointer dans le vide.
--
-- ── PAS pending_actions ──────────────────────────────────────────────────────
-- Une action à valider est quelque chose que l'utilisateur APPROUVE avant
-- exécution (CLAUDE.md §4). Une incohérence à réparer est autre chose : le
-- mélange fausserait le compteur « actions à valider » du cockpit, qui
-- annoncerait un travail que l'artisan ne peut pas faire d'un clic.
--
-- ── APPEND-ONLY, POUR L'INSTANT ─────────────────────────────────────────────
-- `resolu_le` existe pour qu'un futur écran de résolution n'ait pas besoin
-- d'une nouvelle migration, mais RIEN dans ce lot ne l'écrit — pas d'écran de
-- réparation ici. Le GRANT reflète ça : SELECT et INSERT seulement. Le jour
-- où l'écran de résolution existe, il faudra un GRANT UPDATE explicite, migré
-- à part.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS incidents_facturation (
  id           TEXT        PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id),
  -- Un seul type existe aujourd'hui ; la liste blanche évite qu'un type
  -- inventé silencieusement échappe aux écrans qui filtrent dessus.
  type         TEXT        NOT NULL
                           CHECK (type IN ('AVOIR_COMPENSATION_ECHOUEE')),
  facture_id   TEXT        NOT NULL REFERENCES factures(id),
  -- Tout ce qu'il faut pour remettre la facture d'aplomb sans enquête :
  -- identifiant et numéro de la facture, résiduel à restaurer, statut
  -- précédent, numéro d'avoir brûlé, motif saisi, SQLSTATE des deux échecs.
  -- Le motif peut contenir des données métier : cette table est protégée par
  -- RLS comme toute table métier, ce n'est pas un journal.
  charge_utile JSONB       NOT NULL,
  constate_le  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolu_le    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS incidents_facturation_tenant_non_resolus_idx
  ON incidents_facturation (tenant_id)
  WHERE resolu_le IS NULL;

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE incidents_facturation ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents_facturation FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incidents_facturation;
CREATE POLICY tenant_isolation ON incidents_facturation
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Append-only : une trace d'incident ne se réécrit pas depuis ce lot. Le
-- REVOKE est ICI et pas seulement supposé — l'ALTER DEFAULT PRIVILEGES de
-- 002_rls.sql accorde les quatre droits à toute table nouvellement créée, et
-- accorder n'en retire aucun (voir 010, qui a corrigé exactement cet oubli).
REVOKE ALL ON incidents_facturation FROM app_user;
GRANT SELECT, INSERT ON incidents_facturation TO app_user;
