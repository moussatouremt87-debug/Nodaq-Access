# Landing pré-lancement — collecte de liste d'attente

Page **mono-objectif** générée depuis le prompt d'exécution validé par le fondateur
(`structure-landing-page-nodaq-FINALE.md`, framework Dunford/Wiebe/Fletch/Gardner).
Elle remplace intégralement les versions précédentes (v2/v3 « vitrine ») — ce n'est
plus une landing SaaS classique mais une page de collecte d'emails qualifiés.

Fichier unique : `index.html` (HTML + CSS + JS inline, 46 Ko hors polices — cible
< 200 Ko respectée). Aucun build, aucune dépendance hors polices Google Fonts.

## Règles structurantes (ne pas casser)

- **Attention ratio = 1** : aucun menu, aucun lien sortant. Les seuls éléments
  cliquables sont le CTA hero (ancre vers le formulaire), le bouton de soumission,
  et les 2 liens légaux du footer (obligation légale). Le lien d'évitement
  (`skip-link`) est une exigence d'accessibilité, pas un lien concurrent.
- **Un seul champ : l'email.** La question ouverte (verbatims) n'apparaît qu'APRÈS
  la conversion, dans l'état de confirmation.
- **Toute la copy vient du prompt.** Rien inventer : ni statistique, ni citation,
  ni témoignage. Les citations du bloc 3 sont des dirigeants qui décrivent le
  problème (initiale + métier), jamais des avis produit — pas d'avatar, pas
  d'étoiles.
- **Aucun faux signal** : pas de compte à rebours, pas de compteur « en direct »,
  pas de logos clients. « 50 places pour le programme pilote. » est un texte
  statique mis à jour à la main.
- **Statut « en développement » assumé** — c'est le substitut de la preuve sociale.

## Placeholders à remplacer avant mise en ligne

Tous documentés dans le commentaire HTML en tête de `index.html` :

| Placeholder | Où | Quoi |
|---|---|---|
| `[DATE_CALENDRIER]` | Section 5, colonne « À venir » | Laisser visible tant que le fondateur n'a pas fourni la date |
| `[DATE_OUVERTURE_FONDATEURS]` | FAQ, « Quand est-ce disponible ? » | Idem |
| `[ENDPOINT_FORMULAIRE]` | Constante dans le `<script>` | POST du formulaire (champ `email`) et de la question ouverte (champs `email` + `irritant`). Google Form en fallback, sinon endpoint API |
| `[ENDPOINT_MESURE]` | Constante dans le `<script>` | Compteur maison sans cookie (`sendBeacon`) : `conversion_email`, `scroll_section3`, `reponse_irritant`. No-op tant que le placeholder reste. Pas de Google Analytics |

Images du prototype à déposer à côté du fichier : `cockpit-annote.png`,
`devis-dicte.png`, `marge-mission.png`, `echeancier.png`. Tant qu'un fichier manque,
un cadre de substitution affiche le nom attendu — rien ne casse.

Pages légales à créer : `mentions-legales.html`, `confidentialite.html`.

## Comportement du formulaire

- Validation email côté client, message d'erreur sobre.
- Tant que `[ENDPOINT_FORMULAIRE]` n'est pas branché, la soumission affiche
  l'erreur sobre — **pas de fausse réussite**.
- Après succès : l'état de confirmation remplace le formulaire (« Merci — vous êtes
  sur la liste. ») puis pose la question ouverte. La réponse POSTe réellement vers
  le même endpoint avec le champ distinct `irritant` — c'est la boucle de collecte
  de verbatims qui alimentera la V2 de la page.

## Vérifié (Chromium)

- Mobile d'abord (390/640), puis 1024, puis 1440 : aucune erreur JS, aucun
  débordement horizontal, révélations et compteurs fonctionnels.
- Parcours formulaire complet testé contre un endpoint local : email invalide →
  erreur ; email valide → confirmation (formulaire remplacé) ; verbatim → POST réel
  en champ distinct ; « Ignorer » referme la question.
- FAQ `<details>/<summary>` : fermée par défaut, navigable au clavier (testé
  Entrée sur le focus).
- 4 cadres de substitution visibles pour les images prototype absentes.
- Contrastes : gris le plus faible `#838a94` sur `#0a0b0f` ≈ 5,6:1 (AA). Aucun
  bleu, aucun blanc pur en fond, texte sombre sur les aplats vert citron.
- Poids : 45,6 Ko hors polices.

## Reste à faire humainement

**Le test de Shapiro** : faire lire la page à 3 lecteurs hors secteur, dont un hors
bâtiment — non automatisable, à organiser par le fondateur.
