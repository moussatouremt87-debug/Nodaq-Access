# nodaq — règles du dépôt

Application de gestion pour artisans et TPE du bâtiment (3 à 15 salariés). Multi-tenant
strict, données hébergées en France, assistant IA intégré.

> **Langue** : code, identifiants et commentaires techniques en anglais ; documentation
> produit, messages d'erreur destinés à l'utilisateur et messages de commit en français.

---

## Stack

Monorepo **pnpm workspaces**, pnpm **10.34.5** (voir `packageManager`), Node **20**.

- `artifacts/api-server` — API Express, TypeScript ESM, bundle esbuild
- `artifacts/nodaq` — front React + Vite
- `lib/db` — schéma Drizzle, migrations SQL, `withTenant`
- `lib/llm` — **unique** point de sortie vers les modèles
- `lib/classifier`, `lib/facturx`, `lib/fec`, `lib/packs`, `lib/shared`
- PostgreSQL 16. Production : Scaleway, région **fr-par**.

Tests : **Vitest**, sur une vraie base PostgreSQL — jamais de base simulée.

---

## Commandes

```bash
pnpm install                       # pnpm uniquement ; npm et yarn sont refusés
pnpm run typecheck                 # tsc --build puis chaque paquet
pnpm -r --if-present run test      # TOUS les paquets, pas seulement l'API

pnpm db:setup                      # create-app-role → migrate.mjs → seed-owner
pnpm db:migrate                    # migrations seules
```

**Avant de considérer une tâche terminée** : `pnpm run typecheck` **et**
`pnpm -r --if-present run test`, tous deux verts, sur une base **vierge**.

---

## Règles non négociables

### 1. Isolation multi-tenant — deux couches, toujours les deux

**Base** : Row-Level Security `ENABLE` **et** `FORCE` sur toute table portant
`tenant_id`. Le seul accès aux tables métier est `withTenant(tenantId, fn)`, qui pose
`set_config('app.current_tenant_id', …, true)` **dans** la transaction.

**Application** : `requireAuth → resolveTenant → requireMembership → withTenant`.
Le `tenantId` vient **toujours** de la session, jamais d'un paramètre client.

Toute nouvelle table métier ⇒ colonne `tenant_id` + policy RLS `ENABLE`+`FORCE` +
entrée dans `BUSINESS_TABLES` de `helpers.ts` **et** de `rls.test.ts` + test
d'isolation. La CI échoue sinon (garde `pg_class` dans `ci.yml`).

### 2. Une seule sortie vers les modèles

Toute destination de modèle vient de `LLM_BASE_URL`, résolue dans `lib/llm`.

**Interdits, testés par `llm-single-exit.test.ts`** : une URL de fournisseur écrite en
dur dans un fichier source ; les variables `MISTRAL_API_KEY`, `SCALEWAY_API_KEY`,
`LITELLM_*`. **Aucune valeur par défaut** : une variable manquante lève
`LlmConfigError` et la route renvoie 503.

Le nom du modèle est une variable d'environnement, jamais une constante — les
fournisseurs déprécient avec quelques mois de préavis.

### 3. Le modèle ne calcule jamais, ne fixe jamais un prix

Il appelle un outil de la liste blanche (`get_indicateur`) ou s'appuie sur le catalogue
du tenant, puis formule. Un chiffre affiché à l'utilisateur vient toujours d'un calcul
déterministe, jamais du modèle.

### 4. Écriture agentique = validation humaine

Tout outil MCP d'écriture ou d'envoi (`send_*`, `create_*`, `submit_*`) crée une
`pending_action` à valider en un clic. Il n'exécute jamais directement.

### 5. Documents archivés = immuables

Les PDF de factures et d'avoirs vivent dans `archived_pdfs` (bytea), écrits **dans la
même transaction** que le passage en `EMISE`. `app_user` n'a que `SELECT` et `INSERT`
sur cette table — l'immuabilité est une règle du moteur, pas du code.

`create-app-role.cjs` ré-applique cette révocation à chaque exécution : son `GRANT`
massif l'annulerait sinon. Ne retire pas ce bloc.

### 6. Secrets

Jamais en clair, jamais commités, jamais dans une URL de dépôt git, jamais dans un
journal — même tronqués. Ne lis jamais un `.env` réel ; `.env.example` seul est
modifiable. Un secret qui a transité par un chat ou une configuration est **brûlé** :
il faut le révoquer et le régénérer.

Ne logge jamais : contenu de message, lignes FEC, champs extraits d'un document, IBAN,
libellés d'opérations, corps d'e-mail ou de webhook. La journalisation LLM ne consigne
que le nom du modèle, la durée, le nombre de jetons et le code HTTP.

---

## Conventions

**Frontières typées** : toute entrée externe — HTTP, webhook, sortie de modèle — est
validée par Zod.

**Migrations** : un fichier SQL numéroté dans `lib/db/migrations/`, appliqué une seule
fois par `migrate.mjs` et tracé dans `_migrations`. Une migration déjà appliquée ne sera
jamais rejouée — si une propriété doit survivre à une réexécution d'un script, c'est le
script qui doit la porter.

**Identifiants `TEXT`** : générés côté application (Drizzle `$defaultFn`). En SQL brut,
l'`id` doit être fourni explicitement.

**Commits** : Conventional Commits en français (`fix(ci): …`, `feat(facturation): …`).

---

## Pièges déjà rencontrés — ne pas les refaire

**Le superutilisateur contourne la RLS.** L'application tourne sous `app_user`, rôle
non superutilisateur avec `NOBYPASSRLS`. Ne jamais la faire tourner sous `postgres`.

**`app_user` est un rôle de CLUSTER, pas de base.** En PostgreSQL un rôle appartient à
l'instance : le même `app_user` est partagé par toutes ses bases. Faire tourner son mot
de passe affecte donc **TOUTES les bases de l'instance, production comprise** — même
quand la commande vise une base de test jetable. L'application garde l'ancien mot de
passe dans `DATABASE_URL_APP` et tombe aussitôt en `password authentication failed`.

En conséquence : **ne jamais lancer une vérification « base vierge » sur l'instance de
production.** Une base neuve sur l'instance de prod n'est pas un environnement isolé —
elle en partage les rôles. Utiliser une instance séparée (un conteneur jetable sur un
autre port suffit). Et `create-app-role.cjs` ne fait tourner le mot de passe que si on
le lui demande explicitement, avec `--rotate-password`.

**Un `SET` hors transaction fuit entre requêtes** à cause du pooling. Toujours
`set_config(..., true)` **dans** la transaction.

**`select()` sans projection ramène tout.** Ne jamais mettre de colonne volumineuse sur
une table listée par une route : les octets partiraient dans la réponse JSON. C'est la
raison d'être de la table séparée `archived_pdfs`.

**Le disque d'un conteneur est éphémère.** Rien de durable ne s'écrit sur le système de
fichiers. Ni PDF, ni upload, ni cache qui doive survivre.

**Un test qui se saute silencieusement ne protège rien.** Les gardes du type
`if (!process.env.X) return;` ont masqué sept tests de sécurité pendant des semaines.
Le LLM est simulé par `vitest.setup.ts` : aucun test n'a besoin d'une clé réelle.

**Un vert obtenu avec une variable d'environnement locale n'est pas un vert.** Vérifier
sans les secrets, sur une base vierge, comme la CI.

---

## Méthode de travail

1. **Comprendre avant d'écrire.** Lire le code concerné, pas seulement son nom.
2. **Le test d'abord** quand c'est un correctif : reproduire le défaut, puis le corriger.
3. **Une branche par ticket**, une pull request par ticket. Ne jamais pousser sur `main`.
4. **Vérifier à froid** : `rm -rf lib/*/dist lib/*/tsconfig.tsbuildinfo artifacts/*/.tsbuildinfo`
   avant de relancer, sinon un artefact périmé donne un faux vert.
5. **Ne jamais assouplir une assertion pour obtenir du vert.** Si un test échoue,
   s'arrêter et montrer la sortie brute.
6. **Ne jamais ajouter `any`** pour faire taire le compilateur : c'est masquer une
   cause, pas la traiter.
7. **Éprouver les gardes.** Une garde structurelle qu'on n'a jamais vue se déclencher
   n'est pas une garde. Injecter volontairement une violation, vérifier l'échec, retirer.

---

## Ne pas faire

- Appeler un SDK de fournisseur de modèles en direct.
- Lire ou écrire une table métier hors `withTenant`.
- Faire confiance à un `tenantId` venu du client.
- Écrire quoi que ce soit de durable sur le disque.
- Committer un secret, une capture d'écran, ou un document de travail dans le dépôt.
- Refaire la comptabilité : la facture conforme et un export propre suffisent.
