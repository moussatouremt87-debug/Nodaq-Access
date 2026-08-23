# Ticket 4.20 — L'application au doigt, sur un chantier

**Ouvert le 2026-08-20.** Ce ticket lève une dette assumée depuis le 11 août :
« on verra plus tard, surtout quand on fera la version Play Store et App
Store ». C'est ce moment-là.

## Ce que « mobile » veut dire ici

Deux chantiers très différents dorment sous ce mot :

1. **rendre l'application utilisable au doigt** — ce ticket ;
2. **la livrer dans les magasins** (empaquetage natif) — plus tard, et
   volontairement après, car une application native qui embarque des écrans
   non adaptés livre exactement les mêmes défauts, avec une validation Apple
   en plus.

## L'écart mesuré, pas supposé

Constaté le 2026-08-20 en rendant l'application dans un cadre de 390 px :

| Constat | Détail |
|---|---|
| Navigation amputée | 14 destinations atteignables sur les 47 du menu bureau |
| Bandeau coupé | la bande défilante passe sous le bouton de thème, à droite |
| Libellés cassés | « AFFAIRES EN COURS », « FACTURES EN ATTENTE » passent à la ligne |
| Textes tronqués | « 7 420,00 € en retard — … » |
| Boutons cassés | « Compléter le profil » sur deux lignes |
| Écrans nus | 9 sur 37 sans **aucun** point de rupture |

Les 9 écrans sans point de rupture : `login`, `register`, `mfa`,
`affaire-detail`, `pointages`, `parametres-envoi`, `devis-accepter`,
`membre-accepter`, `not-found`. Trois d'entre eux sont des portes d'entrée —
un artisan qui n'arrive pas à se connecter depuis son téléphone n'utilise pas
le produit.

Ce n'est donc pas « cassé » : c'est un produit conçu pour un écran large, qui
tient debout sur un téléphone sans y être agréable.

## Les quatre contraintes, posées par le fondateur

Elles ne sont pas des préférences de style — ce sont les conditions d'usage
réelles d'un artisan sur un chantier, une main occupée et du soleil sur
l'écran :

1. **Cibles tactiles ≥ 44 px.** Y compris les boutons secondaires et les
   lignes de liste. C'est la borne d'Apple, et celle qui compte avec des
   gants.
2. **Une main, pouce en bas.** Les actions principales et la navigation
   descendent là où le pouce atteint. Un menu en haut d'un écran de 6 pouces
   demande de changer de prise.
3. **Lisible en plein soleil.** Contrastes renforcés et corps de texte plus
   grands sur mobile. Le thème sombre est réussi au bureau et illisible
   dehors.
4. **Tolérant au réseau.** Chargement franc, erreurs explicites, aucune perte
   de saisie quand la connexion tombe — sur un chantier, elle tombe.

## Découpage

**Lot A — la coquille.** Navigation basse atteignable au pouce, accès à
**toutes** les destinations (plus seulement 14), cibles ≥ 44 px, et une garde
de parité qui échoue si un écran devient inatteignable sur mobile.

**Lot B — les écrans de terrain.** Cockpit, devis dicté, affaires, heures,
classeur : ceux qu'on ouvre debout. Refonte au doigt, pas simple
réagencement.

**Lot C — les écrans nus.** Les 9 sans point de rupture, en commençant par
les trois portes d'entrée (connexion, inscription, MFA).

**Lot D — lisibilité et réseau.** Échelle typographique mobile, contrastes,
états de chargement et d'erreur, sauvegarde des saisies en cours.

## Une erreur de MESURE, à ne pas refaire

Les constats du tableau ci-dessus ont été obtenus en rendant l'application
dans un cadre de 390 px, **sur un navigateur de bureau**. Or la feuille de
style porte déjà un bloc `@media (pointer: coarse)` qui impose 44 px à toutes
les cibles interactives (US-A8.1). Ce bloc ne se déclenche **jamais** avec un
pointeur de souris : les tailles relevées à l'œil dans cet aperçu sont donc
plus petites que celles d'un vrai téléphone.

Conséquence pratique : une partie des ajustements de hauteur du lot B était
déjà couverte. Ce qui restait vrai, en revanche, ne dépend pas du pointeur —
la DISPOSITION (un bouton pleine largeur sous le pouce plutôt qu'une icône en
haut à droite), les libellés qui passent à la ligne, et la hauteur de fenêtre.

**Règle pour la suite** : un aperçu à 390 px sur un navigateur de bureau
mesure la mise en page, pas les cibles tactiles. Pour celles-ci, la vérité est
dans `index.css` et dans `terrain.test.ts`.

## Une exception envisagée, puis refusée — le micro global

Le lot B a montré **deux microphones** sur le devis dicté : celui de la
dictée, et le micro global de l'assistant juste en dessous. Ils ne font pas la
même chose — l'un remplit la zone de texte, l'autre commande l'assistant — et
l'appui sur le mauvais est plausible.

Une exception masquant le micro global sur cet écran a été posée, puis
**retirée** : la garde `terrain.test.ts` l'a refusée, et le fondateur a
tranché le 2026-08-20 — **le micro global reste sur tous les écrans**. C'est
la promesse « vous ne tapez plus jamais rien », et une promesse à laquelle on
fait une exception n'en est plus une.

Écrit ici pour que personne ne « corrige » ce point plus tard en croyant à un
oubli : c'est un choix, pas un reste.

## Ce qu'on ne fait PAS dans ce ticket

Aucun empaquetage natif, aucun manifeste PWA, aucune notification. Le jour où
ces chantiers arriveront, ils s'appuieront sur ce qui est fait ici — et pas
l'inverse.
