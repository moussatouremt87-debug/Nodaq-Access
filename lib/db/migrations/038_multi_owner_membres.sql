-- Migration 038 — plusieurs OWNER par tenant (US-A5.1)
--
-- Jusqu'ici, AUCUNE invitation ne pouvait donner le rôle OWNER — décision
-- délibérée (bannière en tête de 027_tenant_invites.sql et de
-- routes/membres.ts), appliquée en profondeur par la contrainte CHECK
-- ci-dessous, pas seulement côté Zod.
--
-- US-A5.1 (AC1) demande le contraire pour une société d'exercice libéral à
-- plusieurs associés : chacun doit pouvoir porter le rôle OWNER, à égalité,
-- sans hiérarchie implicite. Décision produit confirmée : un OWNER existant
-- peut désormais désigner un co-OWNER PAR INVITATION (la route
-- `/membres/inviter` reste réservée aux OWNER — seul quelqu'un qui a déjà
-- l'autorité totale peut l'accorder à quelqu'un d'autre). La PROMOTION d'un
-- membre existant en OWNER via `PATCH /membres/:id/role` reste refusée :
-- c'est la portée la plus étroite qui satisfait l'AC1 sans élargir la
-- surface au-delà de ce qui est demandé. Le dernier OWNER d'un tenant reste
-- protégé — la garde applicative passe d'un blocage inconditionnel à un
-- comptage (voir routes/membres.ts).
--
-- Nom de contrainte vérifié en base avant d'écrire cette migration
-- (`SELECT conname FROM pg_constraint WHERE conrelid = 'tenant_invites'::regclass`),
-- pas deviné depuis la convention de nommage implicite de Postgres.

ALTER TABLE tenant_invites DROP CONSTRAINT tenant_invites_role_check;
ALTER TABLE tenant_invites ADD CONSTRAINT tenant_invites_role_check
  CHECK (role IN ('MEMBER', 'ACCOUNTANT', 'OWNER'));

-- US-A5.1 (AC2) — qualifier un accès sans forcer une catégorie inadaptée
-- (ex. "Conjoint collaborateur" : ni salarié, ni simple observateur). Texte
-- libre, jamais un enum fermé — même doctrine que team_members.role, qui
-- porte déjà un libellé de fonction libre pour le personnel de chantier.
-- Le rôle technique (MEMBER/ACCOUNTANT/OWNER) continue seul de déterminer
-- les droits ; `libelle` n'est qu'un texte affiché.
ALTER TABLE memberships    ADD COLUMN IF NOT EXISTS libelle TEXT;
ALTER TABLE tenant_invites ADD COLUMN IF NOT EXISTS libelle TEXT;
