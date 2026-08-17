# Landing pré-lancement — collecte de liste d'attente

Page **mono-objectif** générée depuis le prompt d'exécution validé par le fondateur
(`structure-landing-page-nodaq-FINALE.md`, framework Dunford/Wiebe/Fletch/Gardner).
Elle remplace intégralement les versions précédentes (v2/v3 « vitrine ») — ce n'est
plus une landing SaaS classique mais une page de collecte d'emails qualifiés.

Fichier unique : `index.html` (HTML + CSS + JS inline, ~47 Ko hors polices — cible
< 200 Ko respectée). Aucun build, aucune dépendance hors polices Google Fonts.

## Identité visuelle : fintech (demande du fondateur, 17/08)

La charte NODAQ v2 reste la base (fond `#0a0b0f`, accent unique lime `#a3e635`,
logo N à onde vocale — seul élément au glow appuyé, dégradé orange→rouge réservé
aux chiffres du constat). Par-dessus, un traitement fintech :

- surfaces pleines type produit (`#0e1015`), rayons resserrés (8-10 px),
  liseré haut plus clair sur les cartes ;
- filets hairline entre sections et dans les listes — rythme de relevé bancaire
  (statut, avantages des 50 premiers en un seul relevé à filets) ;
- chiffres en JetBrains Mono tabulaire, labels « registre » en capitales
  espacées (annotations, micro-copy) ;
- index de sections `S.02 → S.08` en mono lime — la numérotation réelle du
  prompt, pas une décoration ;
- calcul Buy Back Your Time encadré d'un filet lime, carte métrique 41 % avec
  règle lime en tête ;
- aucune lueur d'ambiance, aucune ombre portée — l'austérité comme signal de
  confiance.

Maquette Figma : le fichier
[NODAQ — Collecte, identité fintech](https://www.figma.com/design/BprHpxE5U4AhKtcRMlYwo2)
contient la maquette complète des 8 sections (crédit racheté le 17/08) :
hero avec dégradé d'alerte sur « à l'aveugle », constat aux chiffres en
dégradé, carte 41 %, calcul BBYT, 3 cartes problèmes, captures réelles du
prototype, statut 3 colonnes, relevé des avantages fondateurs, FAQ,
formulaire et footer.

## Vidéo d'ambiance du hero (17/08)

Montage de 17 s en boucle : défilé des 4 écrans réels de nodaq alterné avec
4 scènes du quotidien des TPE du bâtiment (départ à l'aube, chantier, devis
dicté dans le fourgon, paperasse du soir), générées via Higgsfield
(Seedance 1.5 Pro, 4 clips muets) puis assemblées en fondu enchaîné
(960×540, 646 Ko, fondu vers le fond #0a0b0f aux extrémités pour une
boucle propre).

- **Décorative uniquement** : opacité 0,32 + dégradé sombre par-dessus —
  le texte du hero reste le sujet. Muette, sans contrôles, en boucle.
- **Garde-fous** : chargée seulement si écran ≥ 640 px **et** sans
  `prefers-reduced-motion` ; si l'autoplay est refusé ou le fichier
  inaccessible, la page reste identique à la version sans vidéo.
- **Hébergement provisoire** : vidéo et poster sont servis par le CDN
  Higgsfield (constante `VIDEO_FOND` + attribut `poster`). **À rapatrier
  en auto-hébergé au moment du déploiement** (les déposer à côté de
  `index.html` et remplacer les deux URLs). Le poids de la page elle-même
  est inchangé (`preload="none"`, rien n'est téléchargé avant que le
  script ne décide de charger).

## Règles structurantes (ne pas casser)

- **Attention ratio = 1** : aucun menu, aucun lien sortant. Les seuls éléments
  cliquables sont le CTA hero (ancre vers le formulaire), le bouton de soumission,
  et les 3 liens légaux du footer (mentions, confidentialité, CGV). Le lien d'évitement
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
| `ENDPOINT_FORMULAIRE` | **Branché et activé** (17/08) | FormSubmit `/ajax` vers `moussatoure.mt.87@gmail.com` — inscription et verbatim, sujets distincts. L'adresse a été activée par le fondateur (« Form Activated », formulaire `nodaq-landing.vercel.app`) : les soumissions arrivent directement par email. Une réponse `success:"false"` reste traitée comme un échec, pas de fausse réussite |
| `[ENDPOINT_MESURE]` | Constante dans le `<script>` | Compteur maison sans cookie (`sendBeacon`) : `conversion_email`, `scroll_section3`, `reponse_irritant`. No-op tant que le placeholder reste. Pas de Google Analytics |

Images du prototype à déposer à côté du fichier : `cockpit-annote.png`,
`devis-dicte.png`, `marge-mission.png`, `echeancier.png`. Tant qu'un fichier manque,
un cadre de substitution affiche le nom attendu — rien ne casse.

Pages légales (créées, même identité visuelle, `noindex`) :
`mentions-legales.html`, `confidentialite.html`, `cgv.html` — liées depuis le
footer. Elles portent des jetons visibles `[À COMPLÉTER : …]` pour les
informations que seul le fondateur connaît (raison sociale, SIREN, hébergeur
du site, durées de conservation, tribunal compétent…). Les CGV sont une
**version préparatoire** clairement annoncée sur la page (produit non
commercialisé) — à faire valider par un conseil juridique avant toute
souscription. Le lien CGV est un ajout demandé par le fondateur par rapport
au prompt initial (qui ne prévoyait que mentions légales + confidentialité).

## Comportement du formulaire

- Validation email côté client, message d'erreur sobre.
- L'endpoint est branché sur FormSubmit → boîte Gmail du fondateur. Tant que
  l'adresse n'est pas activée chez FormSubmit (un clic dans l'email
  d'activation reçu à la première soumission), la soumission affiche l'erreur
  sobre — **pas de fausse réussite**.
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
