# Ticket 4.22 — Le flottement de la suite api-server n'était pas ce qu'on croyait

**Ouvert le 2026-08-21.** À la demande du fondateur, après qu'une vérification
de PR a échoué deux fois de suite sur des fichiers sans rapport avec le
changement livré.

## Ce qu'on croyait

`CLAUDE.md` documente le flottement et l'attribue aux **ports éphémères** :

> Supertest monte un serveur `app.listen(0)` par requête, et la suite api-server
> en compte plus de 300. Lancer les paquets en parallèle les fait puiser tous
> dans la même réserve : d'où des `ECONNRESET` intermittents, sur un test
> différent à chaque fois, jamais reproductibles en isolation.

Le remède retenu était `--workspace-concurrency=1`, qui sérialise les
**paquets**. Une garde (`flottements-suite.test.ts`) interdit par ailleurs de
masquer un flottement avec un `retry`, et elle a raison.

## Ce qui ne collait pas

Le diagnostic explique les `ECONNRESET`. Il n'explique pas les symptômes
observés le 21 août, qui sont d'une autre famille — **la ligne n'est pas là** :

| Fichier | Symptôme |
|---|---|
| `prospection.test.ts` | `expected 201 "Created", got 404 "Not Found"` |
| `facturation.test.ts` | `expected 201 "Created", got 200 "OK"` |
| `regles-relance.test.ts` | `expected 200 "OK", got 404` puis `expected +0 to be 2` |

Un 404 sur `PUT /api/relance/regles` est particulièrement parlant : **aucun
garde de cette pile ne rend 404**. `requireRole`, `lectureSeuleMethode`,
`lectureSeulePerimetre` rendent tous 403 ; `requireAuth` rend 401. Un 404
signifie que la requête n'a atteint aucune route — pas qu'elle a été refusée.

Et surtout : `vitest.config.ts` déclare `singleFork: true`, avec ce commentaire.

> All RLS tests run sequentially in a single fork so they share admin-pool
> setup/teardown **without port collisions**.

Si les fichiers tournaient réellement en fork unique, ni la pression sur les
ports ni l'interférence entre fichiers ne seraient possibles.

## La cause, en quatre maillons

**1. `artifacts/api-server/package.json` déclare `"vitest": "latest"`.** La
version dérive silencieusement à chaque installation. Elle vaut aujourd'hui
**4.1.10**.

**2. `singleFork` n'existe plus.** L'option est absente de tout le typage de
Vitest 4 — `grep -r singleFork node_modules/…/vitest/dist/` ne rend rien. Son
équivalent actuel s'appelle `fileParallelism: false` (ou `maxWorkers: 1`).
L'option posée dans le config est donc **morte, et ignorée en silence**.

**3. `tsc` ne regarde jamais ce fichier.** `artifacts/api-server/tsconfig.json`
déclare `"include": ["src"]`, et `vitest.config.ts` est à la racine du paquet.
`tsc --listFiles` le confirme : zéro occurrence. Le typage de `defineConfig`
aurait refusé la clé inconnue — il n'a jamais été appliqué.

**4. Les fichiers tournent donc en parallèle**, contrairement à ce que le
commentaire promet. La preuve est dans la sortie de chaque exécution :

```
Duration  33.47s (transform 9.30s, setup 727ms, import 86.79s, tests 200.86s)
```

**200,86 s de temps de test cumulé pour 33,47 s de temps réel** — un facteur
six. En fork unique, le temps de test ne peut pas dépasser le temps écoulé.

## Ce que ça explique

Les deux familles de symptômes, d'un coup :

- **`ECONNRESET`** — six forks montant chacun des centaines de serveurs
  `app.listen(0)` puisent dans la même réserve de ports de la machine. C'est le
  mécanisme déjà décrit dans `CLAUDE.md`, à ceci près qu'il n'opère pas entre
  paquets (`--workspace-concurrency=1` le règle) mais **entre fichiers d'un
  même paquet**, où rien ne le règle.
- **« La ligne n'est pas là »** — les fichiers partagent une seule base
  PostgreSQL. Le nettoyage de fin de fichier (`cleanupTenants`,
  `cleanupUsers`) s'exécute pendant qu'un autre fichier est au milieu de ses
  tests. Chaque fichier isole pourtant ses fixtures par `tenant_id` et par
  e-mail unique : **l'interférence exacte reste à identifier**, et c'est le
  premier travail du lot 2 ci-dessous. Ce qui est établi, c'est la
  précondition — le parallélisme — pas encore le chemin précis.

## Ce que ça ne dit pas

Le taux mesuré diffère d'une branche à l'autre (`main` : 1 exécution rouge sur
4 ; la branche du jour : 3 sur 6). **Sur si peu d'exécutions, cet écart n'est
pas significatif** et ne doit pas être présenté comme tel. C'est précisément
pour cela que `scripts/flottement-suite.mjs` existe : mesurer avant de
conclure.

## Le remède, en deux lots

**Lot 1 — refermer la dérive silencieuse.** Trois gestes, dont deux comptent
plus que le correctif lui-même :

1. Remplacer `singleFork: true` par `fileParallelism: false`, et vérifier par
   la mesure que le facteur six disparaît.
2. **Épingler Vitest** à une version explicite. `"latest"` est ce qui a permis
   à l'option de mourir sans bruit ; le corriger sans l'épingler laisserait le
   prochain changement de majeure recommencer.
3. **Faire entrer `vitest.config.ts` dans le périmètre de `tsc`.** C'est le
   maillon qui aurait dû tout arrêter. Tant qu'un fichier de configuration
   n'est pas typé, il peut mentir indéfiniment.

**Lot 2 — établir le chemin exact de l'interférence en base**, une fois la
sérialisation en place : si les symptômes « la ligne n'est pas là »
disparaissent, la précondition suffisait ; s'ils subsistent, il reste un défaut
d'isolation entre fichiers qu'il faut nommer.

> **Mesuré le 21/08 au soir : ils subsistent.** Voir « Ce que la mesure a
> réfuté » ci-dessous. Le lot 2 reste donc entièrement à faire, et l'enquête
> repart d'une case plus honnête.

**Puis mettre `CLAUDE.md` à jour.** Sa section « Pièges déjà rencontrés » décrit
un mécanisme réel mais le situe au mauvais endroit — entre paquets plutôt
qu'entre fichiers — et le remède qu'elle prescrit
(`--workspace-concurrency=1`) ne traite que la moitié du problème. Un piège
documenté à moitié coûte plus cher qu'un piège non documenté : il détourne
l'enquête suivante.

## Ce qu'il ne faut pas faire

Ajouter un `retry`. La garde de `flottements-suite.test.ts` l'interdit, et
l'épisode lui donne raison : un flottement masqué pendant des semaines aurait
laissé cette configuration morte en place indéfiniment.


---

## Ce que la mesure a réfuté (2026-08-21, soir)

Le correctif a été appliqué puis mesuré avec le même harnais, sur la même base,
douze exécutions de chaque côté.

| | exécutions rouges |
|---|---|
| avant (parallèle) | **2 / 12** |
| après (`fileParallelism: false`) | **3 / 12** |

**La sérialisation ne supprime pas le flottement.** L'hypothèse « le
parallélisme est la cause » est réfutée par sa propre mesure. Les deux familles
de symptômes survivent :

- exécution 4 : `affectations.test.ts` — `read ECONNRESET` ;
- exécution 6 : `relance-formulation.test.ts` — le fichier entier ne se charge pas ;
- exécution 11 : `facturation.test.ts` — `DELETE` sur une facture ÉMISE rend
  **404** au lieu de 409, c'est-à-dire que la facture est introuvable.

### Ce qui reste vrai malgré tout

Le défaut de configuration était **réel**, et il est corrigé : les fichiers
tournaient bien à neuf forks (temps de test cumulé 201 s pour 33 s de temps
réel ; après : 84 s pour 121 s). Ça ne se discute pas — ça ne suffisait
simplement pas à expliquer les échecs.

### Ce qui a été écarté depuis

- **Fuite de contexte tenant.** Toutes les `set_config` du dépôt passent bien
  `true` en troisième argument, portée transaction. Le piège documenté dans
  `CLAUDE.md` n'est pas celui-ci.
- **Collision de fixtures entre fichiers.** Chaque fichier isole ses données
  par `tenant_id` et par e-mail horodaté et aléatoire.

### La piste des ports, chiffrée

Cette machine offre **16 384 ports éphémères** (49152–65535) et retient chaque
socket fermé **30 s** (`net.inet.tcp.msl` = 15 000 ms, soit 2×MSL).

La suite monte un serveur `app.listen(0)` **par requête** : de l'ordre de
28 000 sockets par exécution.

| | débit | régime permanent en `TIME_WAIT` |
|---|---|---|
| avant (33 s) | ~860 /s | **~25 800** — au-delà de la réserve |
| après (121 s) | ~237 /s | ~7 100 — sous la réserve, mais du même ordre |

Ce qui explique que les `ECONNRESET` se raréfient sans disparaître : la
sérialisation soulage la pression, elle ne la supprime pas. **Le vrai remède de
cette famille-là est architectural** : monter UN serveur par fichier de test au
lieu d'un par requête. C'est le geste qui ramènerait 28 000 sockets à 95.

Ça ne dit toujours rien de la famille « la ligne n'est pas là ».

### Limites de cette mesure, à ne pas oublier au prochain tour

1. **Le premier relevé sous-comptait.** Le lecteur du harnais ne reconnaissait
   pas la forme `FAIL fichier [ fichier ]` — celle des `ECONNRESET`. Le « 2/12 »
   est donc un **plancher**, pas un taux. Corrigé, et éprouvé sur un échantillon
   des deux formes.
2. **Douze exécutions ne séparent pas 17 % de 25 %.** Aucune des comparaisons
   de ce ticket n'a la puissance statistique de conclure à une différence.
3. **Les douze exécutions partagent une base**, alors que la CI part d'une base
   vierge. Le résidu s'accumule d'une exécution à l'autre — ce n'est pas le même
   environnement.

## Décision à prendre

`fileParallelism: false` coûte **3,6 fois plus de temps** (33 s → 121 s pour ce
seul paquet) et n'achète, à ce stade, **aucune stabilité mesurable**. Trois
options :

1. **Garder la sérialisation** — c'était l'intention d'origine, elle est plus
   sûre sémantiquement sur une base partagée, et elle divise par trois la
   pression sur les ports. On paie 90 s de CI.
2. **Déclarer explicitement `fileParallelism: true`** — assumer le parallélisme
   plutôt que de le subir, garder la vitesse, et attaquer directement le lot 2.
3. **Une base par fork** — garde la vitesse ET l'isolation, mais demande un vrai
   travail sur l'amorçage des tests.

Les deux autres gestes (Vitest épinglé, config typée) ne se discutent pas : ils
sont ce qui empêche la prochaine dérive silencieuse, indépendamment du choix
ci-dessus.


---

# La cause, trouvée (2026-08-22)

Trois hypothèses tombent, dont celle que ce dépôt documentait depuis des mois.

## Ce qui a été RÉFUTÉ, par la mesure

**Les ports éphémères ne sont pas épuisés.** Échantillonné pendant une
exécution complète : le pic atteint **677 sockets en `TIME_WAIT`** sur 16 384
disponibles. Le chiffrage de ce ticket, qui annonçait ~25 800, était une
extrapolation jamais vérifiée. C'est aussi l'explication de `CLAUDE.md`.

**Les descripteurs de fichiers** : limite à 1 048 576. Sans objet.

**Les connexions PostgreSQL** : pic à 11, pour un `max_connections` de 100.

**Le partage de serveur entre tests** : j'ai cru tenir la cause en lisant
`if (!addr) this._server = app.listen(0)` dans supertest — deux requêtes
concurrentes auraient partagé un serveur, et la première à finir l'aurait fermé
sous la seconde. Mais le constructeur appelle `http.createServer(app)` **par
test** : chaque requête a bien son propre serveur.

**La charge seule** : 150 inscriptions séquentielles en isolation, zéro
`ECONNRESET`.

## La cause : le RECYCLAGE des ports, pas leur épuisement

`request(app)` fabrique un serveur HTTP **neuf à chaque appel**. La suite en
compte plus de 28 000. Un port tout juste libéré est réattribué à un serveur
suivant alors qu'un paquet de l'ancienne connexion est encore en vol : la
nouvelle connexion reçoit un RST, et le client voit `read ECONNRESET`.

Mesuré sur 8 000 requêtes identiques, dans le même processus :

| | ECONNRESET | durée |
|---|---|---|
| un serveur par requête | **1** | 4 141 ms |
| un serveur partagé | **0** | 2 080 ms |

Le partage supprime le défaut **et divise le temps par deux** : le coût, c'était
la création et la fermeture d'un serveur à chaque requête.

## Le correctif

`serveurTest(app)` dans `helpers.ts` : un serveur par application, mémoïsé.
845 appels remplacés dans 78 fichiers.

**L'application est un PARAMÈTRE, et ce détail a coûté trois tests.** Une
première version importait l'app statiquement dans `helpers.ts`. Or plusieurs
fichiers simulent un module (`vi.mock`) puis chargent l'app par import différé,
pour éprouver un chemin d'échec : l'import statique chargeait la vraie app
avant eux, leur serveur ne voyait jamais la simulation, et `avoirs-incident`
comme `numero-brule` attendaient 500 en recevant 201. Ils passaient au vert en
n'éprouvant plus rien. La mémoïsation est donc indexée sur l'app elle-même.

**Un second effet, révélateur** : la suite devenue plus rapide a commencé à
déclencher un limiteur de débit que la lenteur masquait — 20 requêtes par
minute depuis la même adresse. Il s'est stabilisé une fois le serveur indexé
par app.

## Le parallélisme est rétabli

La sérialisation posée plus haut reposait sur le diagnostic réfuté. Elle
coûtait un facteur trois sur la CI (16 minutes) sans rien régler — 3 exécutions
rouges sur 12 après, contre 2 sur 12 avant. `fileParallelism` repasse à `true` :
la suite api-server retombe de ~136 s à **~60 s**.

## Mesure après correctif

**13 exécutions consécutives vertes** — 6 en séquentiel, 7 en parallèle —
contre environ une rouge sur quatre auparavant.

**Ce que ça ne prouve pas.** Avec un taux antérieur de ~25 %, treize
exécutions propres ont environ 2,4 % de chance d'arriver par hasard. C'est une
preuve forte, pas une certitude. Et la famille « la ligne n'est pas là »
(404 sur une route qui existe, 201 devenu 200) n'a **pas** été reproduite depuis
le correctif : elle est peut-être la même cause vue autrement, peut-être une
seconde. À rouvrir si elle réapparaît.

## Pourquoi la garde est structurelle

Le taux mesuré est d'environ 1 sur 8 000 requêtes. Un test qui exigerait de
VOIR un `ECONNRESET` serait lui-même flottant — on remplacerait un défaut
intermittent par un autre. `serveur-partage.test.ts` vérifie donc la propriété
stable : aucun fichier ne recrée un serveur par requête, et `helpers.ts`
n'importe pas l'application.
