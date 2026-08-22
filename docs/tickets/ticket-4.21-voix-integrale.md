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

### Lot 4 — la configuration (à faire)

Catalogue, contrats, charges récurrentes, paramètres.

## Dette assumée de ce ticket

`scripts/couverture-vocale.mjs`, annoncé plus haut comme point de départ, **n'a
pas été écrit** : les lots ont avancé sur la liste tenue à la main de la section
« l'écart, chiffré ». Ça tient tant que la liste est courte, et ça cessera de
tenir au lot 4. À écrire avant de déclarer la couverture atteinte — sans quoi
« TOUT faire » restera une appréciation, pas une mesure.
