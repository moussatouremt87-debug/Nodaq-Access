Sur le dépôt Nodaq-Access.

**Première commande, avant tout le reste** :

```
git fetch origin && git checkout llm-sortie-unique
```

La branche existe déjà. Travaille uniquement dessus. **Ne pousse jamais sur `main`.**

---

# Contexte — pourquoi ce ticket

L'application appelle aujourd'hui trois destinations différentes avec trois clés
différentes :

- `lib/llm/src/client.ts` → `chatCompletion` : base `LITELLM_BASE_URL`, **avec
  `https://api.mistral.ai/v1` comme valeur par défaut**
- `lib/llm/src/client.ts` → `mistralVisionCompletion` : **`https://api.mistral.ai/v1`
  écrite en dur**, clé `MISTRAL_API_KEY`, modèle `pixtral-12b-2409`
- `artifacts/api-server/src/lib/scalewaySTT.ts` : **`https://api.scaleway.ai/v1`
  écrite en dur**, clé `SCALEWAY_API_KEY`

Or les documents contractuels du produit (DPA, registre des traitements) désignent un
seul sous-traitant pour les modèles : Scaleway. Le code doit le refléter, et surtout
il doit devenir impossible qu'il en diverge à nouveau sans qu'un test le voie.

Par ailleurs `pixtral-12b-2409` est déprécié dans le catalogue Scaleway et sort du
service le 1er octobre 2026 ; sa fiche ne déclare que l'anglais alors qu'il sert à lire
des factures françaises.

---

# La cible

**Une base, une clé, trois noms de modèles.** L'API de Scaleway est compatible OpenAI,
donc la même base sert `/chat/completions` (chat ET vision) et
`/audio/transcriptions` (audio).

```
LLM_BASE_URL     = https://api.scaleway.ai/v1
LLM_API_KEY      = <clé Scaleway>
LLM_MODEL_CHAT   = mistral/mistral-small-3.2-24b-instruct-2506:fp8
LLM_MODEL_VISION = mistral/mistral-small-3.2-24b-instruct-2506:fp8
LLM_MODEL_STT    = openai/whisper-large-v3
```

**Aucune valeur par défaut, aucun repli.** Si une variable manque, `getConfig()` lève
`LlmConfigError` et l'appelant renvoie 503. Une destination par défaut est précisément
le défaut qu'on corrige : un oubli de configuration ne doit jamais décider en silence
où partent les données.

---

# 1. `lib/llm/src/client.ts`

**`getConfig()`** lit `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_CHAT`. Aucune valeur
par défaut. Chaque variable manquante lève `LlmConfigError` en nommant la variable.
Supprime toute référence à `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `MISTRAL_API_KEY`.

**`chatCompletion`** accepte un modèle optionnel qui remplace `config.model` pour cet
appel. C'est ce qui permet à la vision d'utiliser le même chemin réseau avec un modèle
différent.

**`mistralVisionCompletion` est supprimée.** Elle contient une URL en dur et une
seconde résolution de clé — c'est la porte de sortie non contrôlée qu'on ferme. La
vision n'est pas un fournisseur différent, c'est un modèle différent.

**Nouvelle fonction `transcribeAudio(audioBuffer, mimeType, filename)`** : reprends le
corps de `artifacts/api-server/src/lib/scalewaySTT.ts`, mais construis l'URL comme
`` `${baseUrl}/audio/transcriptions` `` à partir de `LLM_BASE_URL`, avec `LLM_API_KEY`
en autorisation et `LLM_MODEL_STT` comme modèle. Garde `language: "fr"` et
`response_format: "json"`. Exporte-la depuis `lib/llm/src/index.ts`.

Conserve la règle de journalisation existante : on ne consigne que le nom du modèle,
la durée, le nombre de jetons et le code HTTP. **Jamais le contenu des messages.**

# 2. `artifacts/api-server/src/lib/pixtralVision.ts`

Renomme le fichier en `visionExtraction.ts` et mets à jour ses importateurs.

Il appelle désormais `chatCompletion` en passant `process.env.LLM_MODEL_VISION`. Il ne
lit plus aucune variable de fournisseur et ne fait plus de garde sur
`MISTRAL_API_KEY` — c'est `getConfig()` qui garde.

# 3. `artifacts/api-server/src/lib/scalewaySTT.ts`

Supprime le fichier. Son appelant importe `transcribeAudio` depuis `@nodaq/llm`.

# 4. `.env.example`

Documente les cinq variables avec les valeurs Scaleway ci-dessus en exemple. Aucune clé
réelle.

---

# 5. La garde structurelle — c'est la partie qui compte

Ajoute un test dans `artifacts/api-server/src/__tests__/` qui parcourt tous les
fichiers `.ts` sous `artifacts/*/src` et `lib/*/src` (en excluant `node_modules`,
`dist`, et les fichiers de test eux-mêmes) et **échoue en nommant le fichier et la
ligne** si l'un contient :

- une URL de fournisseur — expression régulière sur `https?://` suivi de
  `api.mistral.ai`, `api.scaleway.ai`, `api.openai.com`, `api.anthropic.com` ou
  `generativelanguage.googleapis.com` ;
- l'une des chaînes `MISTRAL_API_KEY`, `SCALEWAY_API_KEY`, `LITELLM_BASE_URL`,
  `LITELLM_API_KEY`.

Après ta refonte, aucun fichier ne doit correspondre. Un commentaire a le droit de
nommer Scaleway, pas d'écrire son URL.

Le message d'échec doit expliquer quoi faire : *« toute destination de modèle doit
venir de LLM_BASE_URL, résolue dans lib/llm »*.

C'est la même mécanique que la garde `withTenant` déjà présente dans `rls.test.ts` —
inspire-toi de sa forme.

---

# 6. Tests existants

Les deux tests de `chat-media.test.ts` qui vérifient le 503 en l'absence de
`MISTRAL_API_KEY` et de `SCALEWAY_API_KEY` doivent porter sur `LLM_API_KEY`. C'est un
**renommage de variable, pas un assouplissement** : l'assertion reste « 503 quand la
configuration manque ». C'est la seule modification de test existant autorisée.

Ajoute aussi un test unitaire : `getConfig()` lève `LlmConfigError` quand
`LLM_BASE_URL` est absente. C'est la protection contre le retour d'une valeur par
défaut.

---

# Vérification obligatoire avant de committer

Depuis une base **vierge** :

```bash
rm -rf lib/*/dist lib/*/tsconfig.tsbuildinfo artifacts/*/.tsbuildinfo
node lib/db/scripts/create-app-role.cjs
node lib/db/scripts/migrate.mjs
node lib/db/scripts/seed-owner.cjs < /dev/null
pnpm run typecheck
pnpm --filter @workspace/api-server run test
```

Les tests ont besoin des nouvelles variables. Mets-les dans l'environnement de test —
`LLM_BASE_URL`, `LLM_API_KEY`, et les trois noms de modèles — avec des valeurs
factices : **les tests ne doivent appeler aucun fournisseur réel.**

Attendu : typecheck à **0 erreur**, **tous les tests au vert** — les 193 existants plus
les tiens.

---

# Interdits

- Ne remets aucune valeur par défaut pour `LLM_BASE_URL`. C'est le cœur du ticket.
- Ne modifie aucun test existant en dehors du renommage de variable décrit au point 6.
- N'ajoute jamais `any` pour faire taire le compilateur.
- Ne touche pas à `.github/workflows/ci.yml`, au `Dockerfile`, ni aux migrations.
- Ne mets aucune clé réelle nulle part, y compris dans `.env.example`.

# Si un test échoue

Arrête-toi et montre la sortie brute. N'assouplis aucune assertion.

# Commit

Un seul commit sur `llm-sortie-unique` :

```
refactor(llm): une seule sortie modèle via LLM_BASE_URL + garde structurelle
```

Puis ouvre une pull request vers `main`. **Ne la fusionne pas** — je la relis avant.
