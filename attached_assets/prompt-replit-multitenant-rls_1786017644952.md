# Prompt Replit — multi-tenant, RLS et authentification réelle

> À coller dans l'agent Replit. **Découpé en 5 phases : fais valider chaque phase avant
> de lancer la suivante.** Une phase à la fois, sinon l'application casse en cours de
> route et tu ne sauras pas où.

---

## ⚠️ À lire avant de coller

Trois pièges tuent 90 % des mises en place de RLS. Ils sont traités dans le prompt,
mais tu dois les connaître pour vérifier :

1. **Le propriétaire d'une table ignore ses propres policies.** `ENABLE ROW LEVEL
   SECURITY` ne suffit pas : il faut `FORCE ROW LEVEL SECURITY`, sinon l'utilisateur
   qui a créé les tables (celui de Replit, par défaut) lit tout, et tes tests passent
   au vert alors que rien n'est protégé.
2. **`SET` hors transaction fuit entre les requêtes.** Avec un pool de connexions, un
   tenant peut hériter du contexte du précédent. Il faut `set_config(..., true)` —
   le `true` limite la portée à la transaction — et **toutes** les requêtes de la
   requête HTTP doivent passer par cette même transaction.
3. **Un test d'isolation qui ne casse pas quand on retire la policy ne prouve rien.**
   C'est le seul test qui compte.

---

# PROMPT À COLLER

```
Tu vas ajouter le multi-tenant, les policies RLS PostgreSQL et une authentification
réelle à cette application. Aujourd'hui : aucune notion de tenant, aucune policy, et
requireAuth compare un cookie à la chaîne constante "authenticated" — donc n'importe
quelle session ouvre tout, et toutes les données sont mélangées.

Stack en place : pnpm workspaces, Express 5, Drizzle ORM, PostgreSQL, Zod, Orval.
Tables métier existantes : settings, echeances, connectors, activity, pending_actions,
chat_messages, cr_entries, classeur_documents, team_members, affaires, factures,
contrats, devis, prospects.

TRAVAILLE EN 5 PHASES. Arrête-toi à la fin de chaque phase, montre-moi le résultat et
attends ma validation avant de passer à la suivante. Ne fais jamais deux phases d'un
coup.

═══════════════════════════════════════════════════════════
PHASE 1 — Rôle Postgres non-propriétaire (le prérequis)
═══════════════════════════════════════════════════════════

1) Crée un rôle applicatif dédié qui n'est ni superuser ni propriétaire des tables :

   CREATE ROLE app_user LOGIN PASSWORD '<mot de passe fort>';
   GRANT USAGE ON SCHEMA public TO app_user;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

2) Ajoute une variable d'environnement DATABASE_URL_APP qui utilise app_user.
   L'application tourne AVEC app_user. Les migrations continuent d'utiliser
   DATABASE_URL (le propriétaire).

3) Vérifie et montre-moi : SELECT current_user; exécuté par l'application au démarrage
   doit renvoyer app_user, pas le propriétaire.

   Si l'hébergeur Postgres ne permet pas de créer un rôle, DIS-LE MOI et arrête-toi :
   sans rôle non-propriétaire, les policies seront contournées et tout le reste est
   décoratif.

═══════════════════════════════════════════════════════════
PHASE 2 — Schéma : tenants, users, memberships, tenant_id
═══════════════════════════════════════════════════════════

4) Nouvelles tables Drizzle :
   - tenants : id (uuid PK), nom, created_at
   - users : id (uuid PK), email (unique, citext ou lower unique), password_hash,
     nom, created_at, last_login_at
   - memberships : id, user_id → users, tenant_id → tenants, role
     ('OWNER' | 'MEMBER' | 'ACCOUNTANT'), created_at. UNIQUE (user_id, tenant_id).
   - sessions : id (uuid PK), user_id, tenant_id (tenant actif), expires_at,
     created_at, user_agent. (Sessions en base, pas dans le cookie.)

5) Ajoute tenant_id (uuid, NOT NULL, FK → tenants) sur les 14 tables métier listées
   plus haut. Procède en trois temps pour ne rien casser :
   a. ajouter la colonne NULLABLE ;
   b. créer un tenant « Migration » et remplir tenant_id de toutes les lignes
      existantes avec son id ;
   c. passer la colonne en NOT NULL.

6) Index composites : (tenant_id, id) sur chaque table, plus (tenant_id, created_at)
   là où il y a un tri chronologique.

7) Montre-moi le diff du schéma et le résultat de la migration sur les données
   existantes (nombre de lignes rattachées par table).

═══════════════════════════════════════════════════════════
PHASE 3 — Policies RLS + accès unique par withTenant
═══════════════════════════════════════════════════════════

8) Pour CHACUNE des 14 tables métier, dans une migration SQL dédiée :

   ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <table> FORCE ROW LEVEL SECURITY;   -- INDISPENSABLE
   CREATE POLICY tenant_isolation ON <table>
     USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
     WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

   Le WITH CHECK est obligatoire : sans lui, on peut INSÉRER dans un autre tenant.
   Les tables tenants, users, memberships et sessions ne sont PAS soumises à cette
   policy — elles sont gérées par du code d'infrastructure, jamais exposées aux routes
   métier.

9) Crée un helper unique withTenant, seul point d'accès aux tables métier :

   export async function withTenant<T>(tenantId: string, fn: (tx) => Promise<T>) {
     return db.transaction(async (tx) => {
       await tx.execute(
         sql`select set_config('app.current_tenant_id', ${tenantId}, true)`
       );
       return fn(tx);
     });
   }

   Le troisième argument `true` limite la portée à la transaction — c'est ce qui évite
   les fuites entre requêtes avec un pool de connexions. NE LE RETIRE PAS.

10) Réécris TOUTES les routes métier pour passer par withTenant et pour n'utiliser que
    le `tx` fourni. Aucune requête métier ne doit plus utiliser `db` directement.
    Liste-moi les fichiers modifiés.

11) Ajoute une garde : un test (ou une règle ESLint) qui échoue si une table métier est
    interrogée en dehors de withTenant. Une convention ne suffit pas.

═══════════════════════════════════════════════════════════
PHASE 4 — Authentification réelle
═══════════════════════════════════════════════════════════

12) Supprime la comparaison `cookies["nodaq_sid"] === "authenticated"`. Remplace par :
    - POST /api/auth/login : email + mot de passe, vérification par hachage
      (argon2id de préférence, sinon bcrypt coût ≥ 12), création d'une ligne sessions,
      cookie signé httpOnly + secure + sameSite=lax contenant l'ID DE SESSION ;
    - POST /api/auth/logout : suppression de la session ;
    - expiration des sessions + prolongation glissante.

13) Chaîne d'autorisation, dans cet ordre, sur toutes les routes métier :
    requireAuth       -> session valide, sinon 401
    resolveTenant     -> tenant actif = celui porté par la session
    requireMembership -> VÉRIFIE EN BASE que l'utilisateur est membre de ce tenant,
                         sinon 403
    withTenant(id)    -> accès aux données

    RÈGLE ABSOLUE : le tenantId ne vient JAMAIS d'un paramètre de requête, d'un header
    ou du corps JSON. Il vient de la session, et il est recontrôlé contre les
    memberships. Écris un test qui envoie un tenantId falsifié dans le corps et vérifie
    qu'il est sans effet.

14) requireRole(['OWNER']) pour les actions sensibles : inviter un membre, connecter un
    connecteur, modifier les paramètres.

15) ADMIN_PASSWORD disparaît. Crée à la place un premier utilisateur OWNER via un
    script d'amorçage, et un parcours d'inscription qui crée user + tenant + membership
    OWNER dans une seule transaction.

═══════════════════════════════════════════════════════════
PHASE 5 — Tests (il n'y en a aucun aujourd'hui)
═══════════════════════════════════════════════════════════

16) Installe Vitest et configure une base PostgreSQL de test RÉELLE (pas de mock : le
    RLS ne se teste que contre un vrai Postgres).

17) Écris au minimum ces tests :

    a) ISOLATION — le test qui compte. Pour chaque table métier : créer deux tenants A
       et B avec des données, lire sous le contexte de A, vérifier que rien de B ne
       remonte. CE TEST DOIT ÉCHOUER si on retire la policy — vérifie-le en la retirant
       temporairement, montre-moi l'échec, puis remets-la.
    b) INSERTION CROISÉE — sous le contexte de A, tenter d'insérer une ligne avec le
       tenant_id de B : doit être refusé (c'est le rôle du WITH CHECK).
    c) FUITE DE CONTEXTE — deux requêtes successives sur la même connexion du pool,
       tenants différents : la seconde ne doit rien voir de la première.
    d) TENANT FALSIFIÉ — un tenantId dans le corps de la requête n'a aucun effet.
    e) APPARTENANCE — un utilisateur authentifié mais non membre du tenant : 403.
    f) SESSION — cookie absent, expiré ou falsifié : 401.
    g) RÔLE — un MEMBER ne peut pas exécuter une action réservée à OWNER.

18) Ajoute un workflow GitHub Actions qui lance typecheck + tests sur chaque push.

═══════════════════════════════════════════════════════════
CE QUE TU NE DOIS PAS FAIRE
═══════════════════════════════════════════════════════════
- Ne fais pas tourner l'application avec le propriétaire des tables ou un superuser.
- N'utilise jamais `SET app.current_tenant_id` hors transaction.
- Ne mets pas le tenantId dans le cookie ou dans un header côté client.
- Ne filtre pas « aussi » en JavaScript en te disant que ça compense : le filtre
  applicatif est un confort, la policy est la garantie.
- Ne déclare pas une phase terminée sans m'avoir montré les tests qui passent.
```

---

## Après l'exécution — ce que tu dois vérifier toi-même

1. **La preuve par le retrait** : demande-lui de désactiver une policy et de relancer
   les tests. Si tout reste vert, l'isolation n'existe pas — c'est en général que
   l'application tourne encore avec le propriétaire des tables.
2. **`SELECT current_user`** au démarrage : doit afficher `app_user`.
3. **Le cookie** : ouvre les outils de développement, vérifie que sa valeur est un
   identifiant de session opaque et non une chaîne fixe.
4. **Deux comptes réels** : crée deux tenants, connecte-toi alternativement, et vérifie
   à l'écran qu'aucune donnée ne traverse.

Tant que ces quatre vérifications ne sont pas faites, **aucune donnée client réelle** ne
doit entrer dans l'application — y compris pendant une démonstration au cabinet.
