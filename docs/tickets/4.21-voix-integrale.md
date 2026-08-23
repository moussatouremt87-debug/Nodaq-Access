# Ticket 4.21 — La voix fait TOUT

**Ouvert le 2026-08-21.** Direction produit du fondateur, énoncée sans
ambiguïté :

> « l'agent vocal doit être omniscient dans l'app et permettre de TOUT
> faire ! »

## L'écart, chiffré

| | Aujourd'hui |
|---|---|
| Actions d'écriture exposées par l'API | **101** |
| Intentions dictables (micro global) | **8** |
| Outils de l'agent de conversation | 14 (dont 5 en lecture) |

Les huit : créer une affaire, créer un prospect, changer le statut d'une
affaire, créer une échéance, créer une entrée de classeur, consigner une
activité, déclarer une absence, affecter un membre.

Ce que la voix ne sait pas faire : **les heures**, les devis (hors écran
dédié), les factures, les avoirs, les paiements, les clients, le catalogue,
les campagnes de relance, les contrats, les charges récurrentes, les
prospects avancés, les paramètres.

## Ce que « tout » ne veut PAS dire

Deux règles du dépôt ne bougent pas, et elles ne s'opposent pas à la
direction — elles la cadrent.

**Règle 4 — écriture agentique = validation humaine.** « Tout faire par la
voix » ne signifie pas « tout écrire sans confirmation ». Le mécanisme existe
déjà et il est le bon : on dicte, le serveur construit un PLAN, l'écran le
montre, l'utilisateur valide d'un geste. Rien ne s'écrit avant. Étendre la
voix, c'est étendre le vocabulaire des plans — pas retirer la validation.

**Règle 3 — le modèle ne calcule rien, ne fixe aucun prix.** Dicter « facture
de 3 400 € » est légitime : le nombre vient de la bouche de l'utilisateur, le
modèle ne fait que l'extraire, et la garde `chiffresInventes` refuse tout
chiffre qui n'était pas dans la phrase. Dicter « facture le solde » et laisser
le modèle calculer ne l'est pas : c'est le serveur qui calcule, toujours.

> **Ce paragraphe a été écrit à l'ouverture du ticket, puis contredit pendant
> quatre lots.** La garde qui appliquait la règle 3 — « aucun schéma
> d'intention ne déclare de champ monétaire » — était plus large que la règle,
> et elle a gagné à chaque fois : elle interdisait aussi de recopier un montant
> prononcé. Le fondateur a tranché après le lot 4 : « il faut changer la règle
> sur l'obstacle. » Voir l'addendum en fin de document.

Autrement dit : **omniscient sur ce qu'on peut DIRE, jamais sur ce qu'il faut
CALCULER ou DÉCIDER.**

## La méthode : rendre la couverture mesurable

Écrire cent intentions à la main sans carte, c'est en écrire trente puis
croire que c'est fini. Le chantier commence donc par un **rapport de
couverture** (`scripts/couverture-vocale.mjs`) qui liste, à chaque exécution,
ce que la voix atteint et ce qu'elle n'atteint pas.

Un rapport et non une garde de CI, pour l'instant : une garde qui échouerait
sur quatre-vingt-dix routes bloquerait tout sans rien apprendre. Elle
deviendra une garde quand la couverture sera proche — c'est-à-dire quand elle
protégera un acquis au lieu de constater un retard.

## Ordre des lots, par valeur d'usage

**Lot 1 — les heures.** « Trois heures chez Delacroix aujourd'hui. » C'est la
saisie qu'on repousse au vendredi et qu'on fait de mémoire, donc mal. L'écran
existe et fonctionne ; c'est le chemin vocal qui manque.

**Lot 2 — le commerce courant.** Créer un client, créer un devis à partir de
lignes dictées (le moteur existe déjà pour le devis dicté : c'est le CHEMIN
vocal global qui manque), envoyer un devis.

**Lot 3 — l'argent.** Facturer un devis accepté, enregistrer un règlement,
lancer une campagne de relance. Chacune de ces opérations produit une
`pending_action` — c'est déjà le cas pour la relance, et c'est le patron.

**Lot 4 — la configuration.** Catalogue, contrats, charges récurrentes,
paramètres. Le moins urgent : ce sont des gestes rares, faits assis.

## Ce qui restera HORS voix, et pourquoi

Certaines actions ne seront jamais dictables, et le rapport de couverture doit
les porter explicitement plutôt que de les compter comme un manque :
authentification, MFA, webhooks entrants, effacement RGPD, rotation de clés.
Dicter « supprime le client Delacroix » à voix haute sur un chantier est une
mauvaise idée, pas une fonctionnalité.

---

## Journal des lots

### Lot 1 — les heures (livré)

`pointer_heures`. Le pointage dicté depuis le chantier, au lieu du vendredi soir
de mémoire.

### Lot 2 — le commerce courant (livré)

`creer_client`, et la correction des champs avant validation : le fondateur a
tranché — « on doit pouvoir dire les noms simplement, le chat bot affiche le
texte pour le soumettre à validation à l'humain pour éviter les erreurs ». D'où
`CHAMPS_CORRIGEABLES` : l'écran rend modifiable ce que l'oreille rate souvent
(un nom propre), et rien d'autre.

### Lot 3 — l'argent (livré)

`enregistrer_reglement`, `lancer_relance`, `facturer_devis`.

**Ce que `facturer_devis` a coûté en conception, et pourquoi.** La conversion
devis → facture vivait dans la route `POST /devis/:id/facturer`, mêlée à son
HTTP. Le chemin vocal ne pouvait donc que la réécrire — c'est-à-dire produire
une SECONDE conversion, qui aurait dérivé de la première au premier correctif.

Elle est donc extraite dans `lib/facturer-devis.ts` (`facturerDevis`,
`totauxFacture`, `messageRefusFacturation`), et la route l'appelle désormais.
L'extraction est *neutre* : les onze tests de `devis-facturer.test.ts` passent
sans être touchés — c'est ce qui la rend démontrable plutôt que crédible.

**Aucun chiffre ne transite par le modèle.** Le schéma ne porte qu'une mention
de devis ; c'est le serveur qui lit le total TTC du devis signé et l'affiche
dans le plan. La garde « aucun schéma d'intention ne déclare de champ
monétaire » l'impose structurellement — elle avait déjà refusé, au lot
précédent, un `montantEuros` que j'avais écrit.

**Le contexte ne propose que les devis ACCEPTÉS non encore facturés**, par
jointure. Un devis déjà facturé n'est donc pas « refusé à l'exécution » : il est
absent du vocabulaire, et le plan dit pourquoi plutôt que de laisser croire à
une erreur d'écoute. L'unicité réelle reste tenue par l'index de la migration
049 — un contrôle applicatif se contourne par deux requêtes simultanées.

**Ce que la voix ne fait toujours pas, délibérément : émettre.** `facturer_devis`
crée un BROUILLON, sans numéro. L'émission scelle un document immuable et
consomme un numéro de séquence : elle reste un geste d'écran.

### Lot 4 — la configuration (livré, sauf les paramètres — voir plus bas)

`creer_article_catalogue`, `creer_charge_recurrente`, `creer_contrat`.

**Le mur, et la façon de le passer.** Les trois objets portent un **montant
obligatoire**, et la garde « aucun schéma d'intention ne déclare de champ
monétaire » interdit à la voix de le porter. Aux lots précédents, la parade
était de faire *calculer* le chiffre par le serveur (le solde d'une facture, le
total d'un devis signé) puis de le donner à corriger. Ici cette parade ne
s'applique pas : le prix d'un article, le montant d'un loyer ou d'un contrat
sont des **décisions commerciales**. Le serveur n'a rien à calculer, et le
modèle n'a pas le droit d'inventer.

D'où un mécanisme neuf, `CHAMPS_A_COMPLETER` : le champ reste **vide**, l'écran
le réclame, et le serveur refuse d'écrire tant qu'il l'est. Ce n'est pas un
demi-chemin — sur le catalogue c'est le seul chemin acceptable, parce qu'un
prix entendu de travers n'abîme pas une ligne : il contamine **tous les devis à
venir**, sans que rien ne le signale. Le rayon de dégât décide, pas la
commodité.

Deux propriétés, tenues par des tests plutôt que par la relecture :

1. Tout champ réclamé est aussi corrigeable — sinon l'utilisateur le
   remplirait et se verrait refuser, sans autre issue que d'annuler.
2. Le refus est **côté serveur** (`422`, distinct du `409` « la cible a
   disparu »). Le bouton grisé n'est qu'un confort : les corrections voyagent
   depuis le navigateur et un plan attend en base jusqu'à une heure.

**Le défaut que le mécanisme a failli introduire.** L'écran ne rendait que les
champs `!= null` : un champ laissé vide ne s'affichait donc *pas*, et la
validation restait bloquée sur un champ invisible. Le compilateur avait
signalé le type manquant ; ce filtre-là, lui, n'aurait rien signalé. C'est le
test de rendu qui le couvre désormais.

**Un second site de construction d'opérations existait** — `mistralAgent.ts`,
pour l'agent de chat. Le compilateur l'a révélé au moment où `aCompleter` est
devenu obligatoire. `aCompleter` y est donc *dérivé* des champs, comme dans
`construirePlan`, plutôt qu'écrit à la main sur chaque site.

### Les paramètres restent HORS voix, et ce n'est pas un oubli

Le lot 4 annonçait « catalogue, contrats, charges récurrentes, **paramètres** ».
Les trois premiers sont livrés ; les paramètres sont écartés, délibérément.

`PATCH /parametres` porte la raison sociale, le **SIRET**, l'**IBAN**, et les
seuils d'objectif. Trois raisons de ne pas les dicter, et aucune n'est de la
prudence de principe :

- Une suite de chiffres dictée est précisément ce qu'une machine entend de
  travers. Un IBAN faux **détourne des virements** ; il n'y a pas de version
  dégradée acceptable.
- La route elle-même refuse déjà les seuils hors bornes, et son commentaire
  cite explicitement « une couche vocale » parmi les sources qu'elle se méfie —
  un taux de 35 points de base au lieu de 3500 produisait un seuil de
  rentabilité vingt fois trop grand, **affiché sans le moindre avertissement**.
- Ce sont des gestes rares, faits assis, une fois. La voix n'y fait rien
  gagner.

C'est le même raisonnement que la section « ce qui restera hors voix » plus
haut, appliqué à un cas qu'elle ne nommait pas encore.

## Dette assumée de ce ticket

`scripts/couverture-vocale.mjs`, annoncé plus haut comme point de départ, **n'a
pas été écrit** : les lots ont avancé sur la liste tenue à la main de la section
« l'écart, chiffré ». Ça tient tant que la liste est courte, et ça cessera de
tenir au lot 4. À écrire avant de déclarer la couverture atteinte — sans quoi
« TOUT faire » restera une appréciation, pas une mesure.


---

## Addendum — le montant prononcé (2026-08-21)

Après livraison du lot 4, décision du fondateur : **« il faut changer la règle
sur l'obstacle. »**

### Ce qui était confondu

La garde « aucun schéma d'intention ne déclare de champ monétaire » traitait
comme une seule chose deux gestes très différents :

- **FIXER un prix** — décider, calculer, arrondir. Interdit au modèle par la
  règle 3, et ça ne bouge pas.
- **RECOPIER un montant prononcé** — « la pose de placo à 45 euros du mètre ».
  Le chiffre sort de la bouche de l'artisan ; le modèle ne décide rien. La
  règle 3 n'a jamais interdit ça.

La confusion coûtait cher et se voyait : le lot 4 faisait retaper à l'écran un
nombre qu'on venait de dire à voix haute. L'ouverture du ticket avait pourtant
énoncé la bonne distinction, noir sur blanc, avant de se faire refuser par sa
propre garde à chaque lot.

### Ce qui remplace l'interdit

La garde est **resserrée, pas supprimée**. Trois conditions cumulatives :

1. **L'humain est la seule source du chiffre**
   (`INTENTIONS_MONTANT_DICTABLE` : catalogue, charge récurrente, contrat,
   règlement). Là où un document fait foi — le solde du journal des paiements,
   le total d'un devis signé — le serveur calcule, et la bouche de
   l'utilisateur n'est pas recevable. **`facturer_devis` reste hors liste,
   définitivement** : facturer autre chose que ce qui a été signé ne se
   rattrape pas. Un test le nomme à part, pour que la relaxe ne s'y étende
   jamais par distraction.
2. **Le montant se retrouve dans la transcription** (`centimesDepuisDictee`).
   Un modèle qui hallucine un chiffre absent de la phrase est arrêté là — sans
   quoi la relaxe ouvrirait exactement le trou qu'elle prétend ne pas ouvrir.
   Non retrouvé, le montant n'est pas « nettoyé » : il est **écarté**, et le
   champ retombe sur le mécanisme du lot 4, vide et réclamé à l'écran. **Le
   repli est l'état sûr.**
3. **En euros, jamais en centimes.** `montantEuros` est le seul nom de champ
   monétaire qu'un schéma ait le droit de déclarer, et un test le vérifie. Un
   modèle qui rendrait des centimes écrirait 45 centimes pour « 45 euros » :
   un facteur cent, silencieux, sur la seule source de prix des devis.

La règle 4 s'applique par-dessus, inchangée : le montant est affiché et
corrigeable avant la moindre écriture.

### Limite assumée

Un nombre transcrit **en toutes lettres** (« quarante-cinq euros ») n'est pas
reconnu, et le champ redevient à saisir. Chercher à lire les numéraux français
buterait sur « un »/« une », articles bien plus souvent que nombres, et
produirait des acceptations sur du hasard. La limite penche du bon côté : elle
coûte une saisie, jamais une écriture fausse.

### Le mécanisme du lot 4 n'a pas été jeté

`CHAMPS_A_COMPLETER` reste, et devient le **repli** du chemin dicté au lieu
d'en être l'unique chemin. C'est ce qui rend la relaxe tenable : il existe un
état sûr vers lequel retomber quand le montant n'est pas vérifiable.
