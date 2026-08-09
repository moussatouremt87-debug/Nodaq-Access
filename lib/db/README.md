# lib/db — Base de données NODAQ

Schéma Drizzle ORM, migrations, scripts de setup et seeds pour PostgreSQL.

---

## Installation complète (première fois ou base vierge)

```bash
pnpm run db:setup
```

Cette commande enchaîne dans l'ordre :

| Étape | Script | Connexion requise |
|-------|--------|-------------------|
| 1. Provisionner `app_user` | `create-app-role.cjs` | `DATABASE_URL` (propriétaire) |
| 2. Appliquer les migrations SQL (schéma + RLS) | `migrate.mjs` | `DATABASE_URL` (propriétaire) |
| 3. Créer le premier tenant + OWNER | `seed-owner.cjs` | `DATABASE_URL` (propriétaire) |

L'étape 1 n'affiche `DATABASE_URL_APP` **que si elle a créé le rôle** (mot de passe
généré). **Copiez-la dans vos Secrets** avant de lancer l'API.

Si `app_user` existait déjà, son mot de passe est **conservé** et aucune chaîne n'est
affichée : continuez d'utiliser le `DATABASE_URL_APP` que vous avez déjà.

---

## Variables d'environnement

| Variable | Utilisée par | Description |
|----------|-------------|-------------|
| `DATABASE_URL` | Scripts de migration uniquement | Connexion propriétaire (SUPERUSER). **Jamais en runtime.** |
| `DATABASE_URL_APP` | Pool applicatif + tests | Connexion `app_user` — soumise au RLS. |
| `SESSION_SECRET` | API Server | Secret HMAC pour les cookies signés (≥ 32 chars). |

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

# Créer toutes les tables (idempotent)
node lib/db/scripts/migrate-multitenant.cjs

# Activer FORCE ROW LEVEL SECURITY + policies tenant_isolation (idempotent)
node lib/db/scripts/migrate-rls.cjs

# Créer le premier tenant + utilisateur OWNER (à lancer une seule fois)
node lib/db/scripts/seed-owner.cjs
```

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


