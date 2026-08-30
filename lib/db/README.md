# lib/db — Base de données NODAQ

Schéma Drizzle ORM, migrations, scripts de setup et seeds pour PostgreSQL.

---

## Installation complète (première fois ou base vierge)

```bash
pnpm run db:setup
```

Cette commande enchaîne dans l'ordre :

| Étape                                                                    | Script                          | Connexion requise                 |
| ------------------------------------------------------------------------ | ------------------------------- | --------------------------------- |
| 1. Provisionner `app_user`                                               | `create-app-role.cjs`           | `DATABASE_URL` (propriétaire)     |
| 2. Appliquer les migrations SQL (schéma + RLS)                           | `migrate.mjs`                   | `DATABASE_URL` (propriétaire)     |
| 3. Reprendre et vérifier les secrets legacy (enchaîné par `migrate.mjs`) | `migrate-connector-secrets.mjs` | `DATABASE_URL` + `ENCRYPTION_KEY` |
| 4. Créer le premier tenant + OWNER                                       | `seed-owner.cjs`                | `DATABASE_URL` (propriétaire)     |

L'étape 1 n'affiche `DATABASE_URL_APP` **que si elle a créé le rôle** (mot de passe
généré). **Copiez-la dans vos Secrets** avant de lancer l'API.

Si `app_user` existait déjà, son mot de passe est **conservé** et aucune chaîne n'est
affichée : continuez d'utiliser le `DATABASE_URL_APP` que vous avez déjà.

---

## Variables d'environnement

| Variable           | Utilisée par                            | Description                                                                                            |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`     | Scripts de migration + démarrage Docker | Connexion propriétaire. Le démarrage Docker la retire de l'environnement avant d'exécuter l'API.       |
| `DATABASE_URL_APP` | Pool applicatif + tests                 | Connexion `app_user` — soumise au RLS.                                                                 |
| `SESSION_SECRET`   | API Server                              | Secret HMAC pour les cookies signés (≥ 32 chars).                                                      |
| `ENCRYPTION_KEY`   | Reprise + API Server                    | Clé AES-256 en base64. Obligatoire avant `db:migrate`, car la reprise ne possède aucun repli en clair. |

---

## Scripts individuels

```bash
# Provisionner app_user (idempotent). Si le rôle existe déjà, son mot de passe
# est CONSERVÉ : seuls les attributs, les GRANT et la révocation append-only
# sont réappliqués. Sans danger sur une instance partagée, production comprise.
node lib/db/scripts/create-app-role.cjs

# Faire tourner le mot de passe — À DEMANDER EXPRÈS.
# DANGER : app_user est un rôle de CLUSTER, partagé par TOUTES les bases de
# l'instance. Une rotation coupe la production tant que DATABASE_URL_APP n'a pas
# été mis à jour partout. Ne jamais lancer ceci contre l'instance de production
# « pour tester ».
node lib/db/scripts/create-app-role.cjs --rotate-password

# Appliquer le SQL puis, obligatoirement, reprendre et vérifier les secrets de
# connecteurs. Un échec de reprise rend la commande non nulle.
pnpm run db:migrate

# Prévisualiser la reprise seule : vérifie les conflits et l'ancien chiffrement,
# mais ne modifie ni connectors.config ni tenant_secrets.
node lib/db/scripts/migrate-connector-secrets.mjs --dry-run

# Créer toutes les tables (idempotent)
node lib/db/scripts/migrate-multitenant.cjs

# Activer FORCE ROW LEVEL SECURITY + policies tenant_isolation (idempotent)
# Y compris la policy publique `devis_public_token_lookup`, qui compare le
# CONDENSAT du jeton d'acceptation depuis la migration 014 — la colonne en clair
# `accept_token` n'existe plus.
node lib/db/scripts/migrate-rls.cjs

# Créer le premier tenant + utilisateur OWNER (à lancer une seule fois)
node lib/db/scripts/seed-owner.cjs
```

---

## Numérotation des migrations

`migrate.mjs` lit `lib/db/migrations/*.sql`, les applique dans l'ordre **alphabétique**
et trace chaque fichier appliqué dans la table `_migrations`, **par nom de fichier**.

Deux conséquences :

**Le préfixe numérique est une étiquette, pas une clé.** Rien n'impose qu'il soit
unique. Deux fichiers portent volontairement le préfixe `002` :

| Fichier           | Rôle                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `002_columns.sql` | Ajoute les colonnes `tenant_id` et celles héritées des anciens scripts |
| `002_rls.sql`     | Crée `app_user`, les GRANT, et active RLS `ENABLE`+`FORCE`             |

L'ordre alphabétique (`'c' < 'r'`) donne exactement l'ordre de dépendance requis : les
colonnes doivent exister avant les policies qui référencent `tenant_id`. **Ce n'est pas
un doublon à corriger.**

**Ne jamais renommer une migration déjà livrée.** `_migrations` indexant par nom, un
renommage fait paraître « en attente » une migration déjà appliquée et la **rejoue sur
toutes les bases existantes**. Les fichiers de ce dépôt sont idempotents, donc un rejeu
passerait sans doute sans dommage — mais il laisserait deux lignes pour la même
migration, et cette propriété n'est garantie par rien.

Une renumérotation reste techniquement possible, à condition de réconcilier
`_migrations` (`UPDATE` de l'ancien nom vers le nouveau) sur **chaque** base existante
avant le déploiement. Le coût dépasse le bénéfice : `003_legacy_upgrade.sql` est un
no-op conservé précisément parce que ce problème s'est déjà posé une fois.

Pour ajouter une migration : prendre le numéro suivant, ne jamais éditer un fichier déjà
livré (le rejeu n'aura pas lieu), et écrire du SQL idempotent.

---

## Seeds de démonstration

```bash
# Données métier (devis, classeur, échéances) — via withTenant
npx ts-node lib/db/src/seed-metier.ts

# Données plateforme (équipe, connecteurs) — via withTenant
npx ts-node lib/db/src/seed-platform.ts
```

> **Important** : les seeds utilisent `withTenant()` et tournent avec `DATABASE_URL_APP`.  
> Ils ne fonctionnent qu'après `db:setup` complet.

---

## Ordre des dépendances

```
create-app-role
      │
      ▼
migrate-multitenant  ◄── crée toutes les tables + index
      │
      ▼
migrate-rls          ◄── active FORCE ROW LEVEL SECURITY + policies
      │
      ▼
connector-secrets    ◄── chiffre la reprise legacy + garde post-reprise
      │
      ▼
seed-owner           ◄── crée tenant + utilisateur OWNER
      │
      ▼
   API Server        ◄── tourne avec DATABASE_URL_APP (app_user, soumis au RLS)
```

---

## Après un changement de schéma

```bash
# 1. Modifier lib/db/src/schema/
# 2. Regénérer les types TS
tsc --build lib/db/
# 3. Écrire un script de migration et l'appliquer avec DATABASE_URL
```
