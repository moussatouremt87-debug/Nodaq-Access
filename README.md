# nodaq

Application de gestion pour artisans et TPE du bâtiment (3 à 15 salariés).
Multi-tenant strict, données hébergées en France, assistant IA intégré.

Les règles du dépôt — non négociables — sont dans [`CLAUDE.md`](./CLAUDE.md).

---

## Développement

Il faut **deux serveurs** : l'API et le serveur Vite. Ils lisent des ports
distincts, et le serveur Vite redirige `/api` vers l'API.

### 1. Les variables

Partez de `.env.example` :

```bash
cp .env.example .env
```

Trois valeurs demandent une attention particulière.

| Variable | Rôle |
|---|---|
| `PORT` | port de **l'API**. Le proxy `/api` du serveur Vite pointe dessus. |
| `FRONTEND_PORT` | port du **serveur Vite**. Doit différer de `PORT`, sinon le proxy se renverrait la requête à lui-même — le fichier de configuration refuse ce cas. |
| `ENCRYPTION_KEY` | **obligatoire** : le serveur refuse de démarrer sans elle. |

Engendrer la clé de chiffrement — ne réutilisez jamais celle d'un autre
environnement :

```bash
openssl rand -base64 32
```

Il n'y a **aucun repli en clair**, et c'est délibéré : un démarrage qui
« fonctionne » sans clé rangerait les secrets en clair sans que personne ne le
remarque.

### 2. La base

```bash
pnpm db:setup     # create-app-role → migrate → seed-owner
```

`create-app-role.cjs` ne fait tourner le mot de passe de `app_user` que si on le
lui demande avec `--rotate-password`. **`app_user` est un rôle de CLUSTER** : le
faire tourner affecte toutes les bases de l'instance, production comprise.

### 3. Les deux serveurs

Dans deux terminaux :

```bash
# API
pnpm --filter @workspace/api-server run dev

# Interface
pnpm --filter @workspace/nodaq run dev
```

L'interface est alors sur `http://localhost:$FRONTEND_PORT`, et ses appels
`/api/…` sont redirigés vers l'API.

> **Sans le proxy**, le SPA interrogerait le serveur Vite, qui ne connaît pas
> ces routes : l'application démarre, s'affiche, et se comporte comme si les
> données n'existaient pas. La page publique d'acceptation annonçait ainsi
> « Lien invalide ou expiré » sur un jeton parfaitement valide.

---

## Vérifier

```bash
pnpm run typecheck
pnpm -r --if-present run test      # TOUS les paquets
```

Les deux doivent être verts sur une base **vierge**, comme en CI.

### Les trois fuseaux

Les bornes de période, les dates d'émission et les exercices dépendent du
fuseau. La suite se lance donc trois fois, en posant **les deux** variables :

```bash
TZ=UTC              TZ_ATTENDU=UTC              pnpm -r --if-present run test
TZ=Europe/Paris     TZ_ATTENDU=Europe/Paris     pnpm -r --if-present run test
TZ=Pacific/Auckland TZ_ATTENDU=Pacific/Auckland pnpm -r --if-present run test
```

`TZ_ATTENDU` n'est pas une redite de `TZ` : c'est ce que la garde
`tools/tests/fuseau-attendu.test.ts` compare au fuseau **réellement résolu**.
Sans elle, un paquet qui ré-épinglerait son fuseau passerait les trois
exécutions en vert sans jamais quitter Paris.

Auckland n'est pas décoratif : en avance sur UTC, c'est le fuseau qui révèle
une date métier construite depuis un instant.

### À froid

Un artefact périmé donne un faux vert :

```bash
rm -rf lib/*/dist lib/*/tsconfig.tsbuildinfo artifacts/*/.tsbuildinfo
```

---

## Production

L'API sert elle-même le SPA bâti : une seule origine, et le proxy ne sert plus.
Seul `PORT` compte.
