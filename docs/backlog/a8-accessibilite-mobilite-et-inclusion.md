# Epic A8 — Accessibilité, mobilité & inclusion

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE A — TRONC COMMUN (toute TPE/PME)

### US-A8.1 — Interface utilisable dans un contexte de travail physique, tous secteurs
**Segments :** tout métier avec des contraintes physiques au travail : gants (bâtiment,
industrie), mains mouillées ou grasses (restauration, mécanique), plein air (paysage,
transport), bruit ambiant (industrie, restauration).
**En tant qu'** utilisateur en situation de travail physique contraignante, **je veux**
une interface utilisable sans les mains libres ou dans un environnement bruyant, quel
que soit mon métier, **afin de** pouvoir m'en servir dans les conditions réelles de mon
activité et non uniquement dans un bureau calme.

**Contexte :** les contraintes déjà identifiées pour le bâtiment (gants, plein soleil,
bruit de chantier) ont des équivalents directs dans d'autres secteurs — mains grasses
en cuisine ou en mécanique, plein air en paysagisme, bruit en cuisine de restaurant.

**Critères d'acceptation :**
- Étant donné une utilisation avec des gants ou mains occupées, quand l'utilisateur
  interagit avec les zones tactiles principales, alors leur taille reste suffisante
  quel que soit le secteur, sans dimensionnement spécifique au bâtiment.
- Étant donné un environnement bruyant (cuisine de restaurant, atelier), quand une
  dictée vocale est utilisée, alors sa fiabilité reste comparable à celle mesurée sur
  chantier.
- Étant donné une utilisation en extérieur en plein soleil (paysagiste, livreur), quand
  l'écran est consulté, alors le contraste reste suffisant, sans dépendre d'un thème
  pensé uniquement pour un usage intérieur de bureau.

**Points d'attention :** ces contraintes ont déjà été identifiées et en partie
adressées côté bâtiment — le travail ici est de vérifier la généricité de la solution,
pas de la reconstruire.

**Priorité :** Should — condition d'usage réelle sur le terrain pour plusieurs
secteurs, au-delà du seul bâtiment.

---

### US-A8.2 — Accessibilité pour les situations de handicap, tous secteurs
**Segments :** tous secteurs, utilisateurs en situation de handicap (visuel, moteur,
cognitif).
**En tant qu'** utilisateur en situation de handicap, **je veux** que l'application
respecte les standards d'accessibilité (WCAG) quel que soit l'écran ou le secteur
affiché, **afin d'** accéder à la gestion de mon entreprise dans les mêmes conditions
qu'un utilisateur sans contrainte, quel que soit mon métier.

**Contexte :** cette exigence est transversale par nature — un audit d'accessibilité
mené sur les seuls écrans bâtiment ne garantit rien sur les futurs écrans sectoriels
(commerce, santé, etc.) qui seront construits ensuite.

**Critères d'acceptation :**
- Étant donné n'importe quel écran de l'application, quel que soit le secteur affiché,
  quand il est audité, alors il respecte le niveau WCAG 2.1 AA au même titre que les
  écrans existants.
- Étant donné un nouvel écran sectoriel ajouté, quand il est livré, alors l'audit
  d'accessibilité fait partie de la définition de "terminé", pas une vérification
  différée après coup.
- Étant donné un utilisateur de lecteur d'écran, quand il navigue sur un écran
  spécifique à un nouveau secteur (par exemple prise de rendez-vous), alors la
  navigation reste cohérente avec le reste de l'application.

**Points d'attention :** intégrer l'audit d'accessibilité comme critère de définition
de "terminé" pour tout nouveau module sectoriel, plutôt que comme un chantier séparé
mené après coup sur l'ensemble du produit.

**Priorité :** Must — obligation légale progressive en France (RGAA) au-delà d'un
simple choix de qualité produit.

---

### US-A8.3 — Interface multilingue pour une main d'œuvre diverse
**Segments :** tous secteurs à main d'œuvre non exclusivement francophone (bâtiment,
restauration, services à la personne, agriculture).
**En tant que** salarié dont le français n'est pas la langue maternelle, **je veux**
pouvoir consulter mon planning et pointer mes heures dans une interface aux libellés
simples, complétée d'icônes ou d'une langue alternative courante, **afin de** comprendre
mes tâches sans dépendre systématiquement d'un collègue traducteur.

**Contexte :** ce besoin est documenté pour le bâtiment mais concerne tout aussi
directement la restauration, les services à la personne ou l'agriculture, secteurs à
main d'œuvre également diverse.

**Critères d'acceptation :**
- Étant donné un salarié dont la langue préférée est déclarée différente du français,
  quand il consulte son planning, alors les libellés essentiels (jour, horaire, lieu)
  sont doublés d'une iconographie compréhensible indépendamment de la langue.
- Étant donné les mêmes écrans, quand une traduction dans une langue courante du secteur
  concerné est disponible, alors elle peut être activée sans configuration complexe.
- Étant donné une fonctionnalité non encore traduite, quand un utilisateur non
  francophone y accède, alors elle reste utilisable via son iconographie et sa
  structure visuelle, même sans traduction complète du texte.

**Points d'attention :** prioriser d'abord les écrans à plus fort usage salarié
(pointage, planning) avant une traduction exhaustive de toute l'application, pour un
retour sur investissement plus rapide.

**Priorité :** Should — fort impact social et d'adoption dans plusieurs secteurs à main
d'œuvre diverse, non bloquant techniquement pour un premier lancement.

---

### US-A8.4 — Mode simplifié pour utilisateur peu à l'aise avec le numérique
**Segments :** tous secteurs, utilisateurs seniors ou peu formés au numérique —
particulièrement fréquent chez les artisans et commerçants indépendants de longue date.
**En tant qu'** utilisateur peu à l'aise avec les outils numériques, **je veux** un
mode d'interface simplifié qui masque les fonctions avancées non essentielles à mon
usage quotidien, **afin de** ne pas être submergé par des options que je n'utiliserai
jamais, quel que soit mon secteur.

**Contexte :** ce besoin n'est pas propre à un métier — il traverse tous les secteurs
où une part significative des dirigeants n'a pas grandi avec le numérique, notamment
les artisans et commerçants de plus de 50 ans.

**Critères d'acceptation :**
- Étant donné un utilisateur qui active le mode simplifié, quand il navigue dans
  l'application, alors seules les fonctions essentielles (devis/proposition, facture,
  planning basique) restent visibles par défaut.
- Étant donné ce mode actif, quand une fonction avancée est nécessaire ponctuellement,
  alors elle reste accessible via une option explicite "afficher plus", sans être
  supprimée définitivement.
- Étant donné un changement de mode (simplifié vers complet), quand il est effectué,
  alors aucune donnée ni configuration n'est perdue dans la transition.

**Points d'attention :** ce mode doit être un habillage de l'interface existante, pas
une version de l'application à maintenir séparément — le risque de double maintenance
serait disproportionné par rapport au bénéfice.

**Priorité :** Should — fort impact sur l'adoption dans un segment démographique
important, réalisable comme une couche d'interface plutôt qu'un nouveau produit.
