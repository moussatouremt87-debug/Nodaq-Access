# Landing page pré-lancement — programme Fondateurs (v3)

Page de **génération de leads inbound**, générée à partir du document de génération
« Prompt complet — génération de la landing page NODAQ (v3) » (document de travail,
non versionné ici). Ce n'est pas une page de vente : aucun paiement, aucun champ de
saisie, aucun simulateur. Son seul objectif de conversion est le clic vers le Google
Form externe.

Fichier unique et autonome : `index.html` (HTML + CSS + JS inline). Aucun build, aucune
dépendance à installer. Elle vit hors des workspaces pnpm — c'est un livrable statique,
pas un paquet du monorepo.

## Ce qui distingue la v3 de la v2

- **Le constat ouvre la page**, juste après la nav, avant le hero — la page ne « vend »
  qu'après avoir démontré qu'elle comprend le problème.
- **7 cartes fonctionnalités** : ajout de « Vos chiffres ne mentent jamais » (fraîcheur
  temps réel du cockpit), en carte large pleine ligne.
- **5 items sécurité** : ajout de « L'effacement, vraiment complet » (RGPD art. 17).
- **Vidéo hero avec voix off** : démarrage muet (contrainte navigateur), bouton
  « Activer le son » visible dès que la vidéo est chargée — jamais silencieuse sans
  recours. À l'activation, la narration repart du début.
- **Logo réel** : monogramme « N » lime à onde vocale en négatif sombre, points pâles
  lumineux aux extrémités. **Seul élément autorisé au glow appuyé** (charte v2) — le
  vert citron reste plat partout ailleurs.
- Maquette de référence construite dans Figma avant le code :
  [NODAQ — Landing Fondateurs v3](https://www.figma.com/design/xZ57hDOGiokFubJut7gjhI)
  (page « 🧩 Tokens & Composants » : variables de couleur scopées, styles de texte,
  composants Bouton/Badge/Cartes ; page « 🖥 Landing v3 » : la maquette complète).

## Prévisualiser

```bash
cd marketing/landing && python3 -m http.server 8080
# puis http://localhost:8080
```

## À FAIRE avant toute mise en ligne

1. **Remplacer `PLACEHOLDER_GOOGLE_FORM_URL`** par l'URL réelle du formulaire.
   Cinq occurrences : nav, hero, carte tarifaire, section Fondateurs, CTA finale.

   ```bash
   grep -c PLACEHOLDER_GOOGLE_FORM_URL index.html   # doit renvoyer 0 avant publication
   ```

2. **Renseigner les liens légaux du footer** (mentions légales, confidentialité, CGV),
   aujourd'hui en `href="#"`.

3. **Témoignages.** Les trois citations (Karim B., Sofiane R., Thomas L.) sont des
   personas, pas de vrais clients — étiquetées « Exemples d'usage » sous la grille.
   Cette mention doit rester tant que les citations ne sont pas de vrais retours.

4. **Vidéo + voix off.** Le hero attend `assets/hero-loop.mp4` : clip 16-20 s, 16:9,
   en boucle, AVEC la narration française (script : « Ce soir encore, vous finissez la
   journée à minuit… »). À générer via Higgsfield (prompts en section 5 du document de
   génération). **Blocage constaté le 16/08 : le compte Higgsfield de la session est à
   0 crédit (plan gratuit)** — la génération attend soit des crédits, soit un autre
   outil. La page ne dépend pas du fichier : sans lui, le `<video>` se retire au
   premier `error` et le bouton son n'apparaît jamais.

5. **Vérifier le bouton son en réel.** Le circuit « pas de vidéo → bouton caché » est
   testé ; le circuit « unmute → narration depuis le début » est relu mais n'a pas pu
   être éprouvé sans fichier vidéo réel (pas de ffmpeg dans l'environnement de build).

## Repères de conception

- **Palette** : fond `#0a0b0f`, accent **unique** vert citron `#a3e635`
  (`#bef264` hover, `#d9f99d` clair). Aucun bleu. Le dégradé orange→rouge
  `#f59e0b`→`#ef4444` est réservé aux chiffres qui inquiètent — jamais un CTA.
- **Contraste** : sur un aplat vert citron, le texte est sombre (`#0a0b0f`), jamais
  blanc.
- **Glow** : réservé aux deux points du logo. Les `.glow` de fond sont des lueurs
  d'ambiance radiales, pas des effets sur des éléments.
- **Chiffres** : les quatre statistiques du constat et leurs sources (Coface 2025,
  Coface/Altares 2025, SDI) sont celles du document. Ne pas en inventer d'autres.
- **Compteur de places** : texte statique, mis à jour à la main. Pas de compte à
  rebours, pas de compteur « en direct ».
- **Tarifs** : offre Essentiel v1 (49 € HT/mois + 9 € HT/salarié, essai 30 jours,
  290 € HT de mise en route). Le programme Fondateurs promet le verrouillage de CE
  tarif : ne pas ajouter de découpage Essentiel/Pro sans validation explicite.

## Vérifié

Rendu contrôlé sous Chromium à 1440 / 900 / 390 px : aucune erreur JS, aucun
débordement horizontal, révélations au scroll et compteurs fonctionnels.

Pièges rencontrés, à ne pas réintroduire :

- Les lueurs `.glow` ont des décalages négatifs et élargissaient le document — d'où la
  barre de défilement horizontale. `.section` porte `overflow: hidden` pour cette
  raison.
- `html` porte `scroll-behavior: smooth` (pour les ancres). Un script de test qui
  appelle `window.scrollTo` en boucle doit passer `behavior: 'instant'`, sinon le
  défilement animé ne rend jamais les zones traversées et les révélations semblent
  cassées à tort.
- La passe typographique (apostrophes courbes) doit sauter la ligne de la favicon :
  ses apostrophes droites sont des délimiteurs d'attributs SVG.
