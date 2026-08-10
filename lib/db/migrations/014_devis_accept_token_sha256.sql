-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 014 — le jeton d'acceptation ne vit plus en base
--
-- (013 est prise par le magasin de secrets. 012 par le correctif CA.)
--
-- `devis.accept_token` était un jeton PORTEUR conservé en clair. Qui lit une
-- sauvegarde, un réplica, ou la base en superutilisateur pouvait accepter un
-- devis à la place du client — et l'application enregistrait alors un
-- horodatage, un nom de signataire et une adresse IP qui font foi. Une preuve
-- d'engagement falsifiable.
--
-- On range désormais le CONDENSAT SHA-256 et on compare des condensats. Le
-- jeton ne vit plus que dans le lien envoyé au client.
--
-- Bénéfice secondaire, et il compte : le jeton ne voyage plus dans une
-- instruction SQL. C'est exactement le défaut invoqué contre pgcrypto au lot
-- précédent, qui était présent ici, sur un jeton porteur.
--
-- ── LA REPRISE N'EST POSSIBLE QUE PARCE QUE LE DÉFAUT EXISTE ─────────────────
-- Les jetons étant en clair aujourd'hui, on peut les condenser avant de
-- supprimer la colonne : les liens déjà envoyés aux clients continueront de
-- fonctionner. C'est la seule et unique occasion de le faire sans casser un
-- lien. Après cette migration, un jeton perdu est perdu.
--
-- ── LE SEUL USAGE LÉGITIME DE pgcrypto DU DÉPÔT ─────────────────────────────
-- Le lot chiffrement a proscrit pgcrypto parce que la CLÉ voyagerait dans
-- l'instruction SQL, donc dans pg_stat_activity et les journaux du serveur.
-- Ici, `digest()` ne reçoit AUCUNE clé : il calcule un condensat non salé
-- d'une valeur DÉJÀ présente dans la même table. Rien de neuf ne transite.
-- L'interdiction porte sur le transport de clés, pas sur la fonction.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. La colonne de condensat.
--
-- chiffrement-derogation: condensat SHA-256, pas un secret réversible — même
-- nature que users.password_hash. Le chiffrer n'apporterait rien : on ne peut
-- rien en faire même en clair, et il n'ouvre aucun accès chez un tiers. Il doit
-- de surcroît rester COMPARABLE, puisque la policy publique s'en sert dans un
-- prédicat d'égalité sur une colonne indexée — ce que le magasin interdit par
-- construction (l'IV est tiré au sort, deux chiffrés d'une même valeur
-- diffèrent).
ALTER TABLE devis ADD COLUMN IF NOT EXISTS accept_token_sha256 TEXT;

-- 2. Reprise des jetons existants, en heure de rien du tout : un condensat
--    n'a pas de fuseau. Seules les lignes qui portent un jeton sont touchées.
UPDATE devis
   SET accept_token_sha256 = encode(digest(accept_token, 'sha256'), 'hex')
 WHERE accept_token IS NOT NULL
   AND accept_token_sha256 IS NULL;

-- 3. Index UNIQUE par tenant.
--
--    Unique parce qu'un jeton qui ouvrirait deux devis serait un défaut, et
--    qu'on préfère l'apprendre à l'écriture qu'à la lecture. Les NULL ne
--    entrent pas en conflit en PostgreSQL : les devis jamais envoyés — la
--    majorité — cohabitent sans contrainte.
CREATE UNIQUE INDEX IF NOT EXISTS devis_tenant_accept_token_sha256_uidx
  ON devis (tenant_id, accept_token_sha256);

-- 4. La policy étroite compare désormais sur le condensat.
--
--    Le réglage de session change de NOM en même temps que de contenu :
--    `app.devis_accept_token_sha256`. Garder l'ancien nom pour une valeur de
--    nature différente ferait qu'un déploiement à moitié à jour laisserait
--    passer — ou refuserait — sans qu'on comprenne pourquoi.
DROP POLICY IF EXISTS devis_public_token_lookup ON devis;

CREATE POLICY devis_public_token_lookup ON devis
  FOR SELECT TO app_user
  USING (
    accept_token_sha256 IS NOT NULL
    AND accept_token_sha256 = current_setting('app.devis_accept_token_sha256', true)
  );

-- 5. Suppression de la colonne en clair.
--
--    Après la policy, jamais avant : une policy qui référence une colonne
--    supprimée empêche le DROP, et le faire dans l'autre ordre exigerait un
--    CASCADE qui détruirait la policy sans qu'on l'ait décidé.
ALTER TABLE devis DROP COLUMN IF EXISTS accept_token;
