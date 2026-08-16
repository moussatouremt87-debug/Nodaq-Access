# Landing page pré-lancement — programme Fondateurs

Page de **génération de leads inbound**, générée à partir du document de génération
« Prompt complet — génération de la landing page NODAQ » (document de travail, non
versionné ici). Ce n'est pas une page de vente : aucun
paiement, aucun champ de saisie, aucun simulateur. Son seul objectif de conversion est
le clic vers le Google Form externe.

Fichier unique et autonome : `index.html` (HTML + CSS + JS inline). Aucun build, aucune
dépendance à installer. Elle vit hors des workspaces pnpm — c'est un livrable statique,
pas un paquet du monorepo.

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
   personas, pas de vrais clients. Elles sont donc explicitement étiquetées
   « Exemples d'usage — scénarios illustratifs, pas encore des témoignages clients »
   sous la grille. Cette mention doit rester tant que les citations ne sont pas de vrais
   retours de fondateurs ; le jour où elles le deviennent, retirer la mention et
   remplacer les personas.

## Vidéo du hero

Le hero attend `assets/hero-loop.mp4` — clip d'ambiance de 16-20 s, 16:9, muet, en
boucle, à générer avec le prompt vidéo (section 5 du document de génération). Le binaire
n'est pas versionné : le déposer au moment du déploiement.

La page ne dépend pas de ce fichier : en son absence, le `<video>` est retiré au premier
`error` et le voile dégradé tient seul sur le fond. Le lecteur est en `muted` + `playsinline`
+ `preload="none"` — sans quoi l'autoplay est refusé sur mobile et la vidéo pèserait sur
le premier rendu.

## Repères de conception

- **Palette** : fond `#0a0b0f`, accent **unique** vert citron `#a3e635`
  (`#bef264` hover, `#d9f99d` clair). Aucun bleu. Le dégradé orange→rouge
  `#f59e0b`→`#ef4444` est réservé aux chiffres qui inquiètent — jamais un CTA.
- **Contraste** : sur un aplat vert citron, le texte est sombre (`#0a0b0f`), jamais
  blanc.
- **Chiffres** : les quatre statistiques du constat et leurs sources (Coface 2025,
  Coface/Altares 2025, SDI) sont celles du document de génération. Ne pas en inventer
  d'autres.
- **Compteur de places** : texte statique, mis à jour à la main. Pas de compte à rebours,
  pas de compteur « en direct ».
- **Tarifs** : reflètent l'offre Essentiel v1 (49 € HT/mois + 9 € HT/mois par salarié,
  essai 30 jours, 290 € HT de mise en route). Le programme Fondateurs promet le
  verrouillage de ce tarif, pas un choix entre paliers : ne pas ajouter de découpage
  Essentiel/Pro ici sans validation explicite.

## Vérifié

Rendu contrôlé sous Chromium à 1440 / 900 / 390 px : aucune erreur JS, aucun débordement
horizontal, les 67 révélations au scroll se déclenchent, les compteurs s'animent.

Deux pièges rencontrés, à ne pas réintroduire :

- Les lueurs `.glow` ont des décalages négatifs et élargissaient le document — d'où la
  barre de défilement horizontale. `.section` porte `overflow: hidden` pour cette raison.
- `html` porte `scroll-behavior: smooth` (pour les ancres). Un script de test qui appelle
  `window.scrollTo` en boucle doit passer `behavior: 'instant'`, sinon le défilement
  animé ne rend jamais les zones traversées et les révélations semblent cassées à tort.
