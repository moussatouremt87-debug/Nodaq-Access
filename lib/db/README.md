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
| 1. Créer `app_user` | `create-app-role.cjs` | `DATABASE_URL` (propriétaire) |
| 2. Créer toutes les tables | `migrate-multitenant.cjs` | `DATABASE_URL` (propriétaire) |
| 3. Activer le RLS | `migrate-rls.cjs` | `DATABASE_URL` (propriétaire) |
| 4. Créer le premier tenant + OWNER | `seed-owner.cjs` | `DATABASE_URL` (propriétaire) |

Après l'étape 1, le script affiche `DATABASE_URL_APP` (URL avec mot de passe aléatoire).  
**Copiez-la dans vos Secrets** avant de lancer l'API.

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
# Créer app_user (idempotent — réinitialise le mot de passe si déjà existant)
node lib/db/scripts/create-app-role.cjs

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
