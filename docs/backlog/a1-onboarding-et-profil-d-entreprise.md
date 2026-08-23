# Epic A1 — Onboarding & profil d'entreprise

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE A — TRONC COMMUN (toute TPE/PME)

### US-A1.1 — Un onboarding qui ne présume pas du secteur
**Segments :** toute TPE/PME, en particulier hors bâtiment (le secteur est aujourd'hui
la première question posée, avec un vocabulaire orienté chantier).
**En tant qu'** utilisateur qui crée son compte, **je veux** que la première question
porte sur mon secteur d'activité réel (commerce, restauration, service à la personne,
profession libérale, bâtiment, transport, santé…) **afin de** recevoir ensuite un
vocabulaire, des modèles de documents et des obligations légales adaptés à mon métier,
et non un habillage "chantier" qui ne me concerne pas.

**Contexte :** aujourd'hui, l'écran d'onboarding parle de "chantier", "décennale",
"votre métier" au sens BTP. Un coiffeur ou un consultant qui tombe dessus comprend
immédiatement que l'outil n'est pas fait pour lui, même si le reste du produit
conviendrait.

**Critères d'acceptation :**
- Étant donné un nouvel utilisateur, quand il arrive sur l'onboarding, alors la première
  question est "quel est votre secteur d'activité ?" avec une liste couvrant au minimum
  bâtiment, commerce, restauration/CHR, services à la personne, professions libérales,
  artisanat de service, services aux entreprises, transport, santé libérale.
- Étant donné un secteur sélectionné, quand l'onboarding se poursuit, alors le
  vocabulaire affiché (devis → "devis" ou "proposition commerciale" selon le secteur,
  chantier → "mission"/"intervention"/"prestation") s'adapte au secteur choisi.
- Étant donné un secteur non encore couvert par un module dédié, quand l'utilisateur le
  sélectionne, alors il obtient une configuration générique fonctionnelle plutôt qu'un
  blocage ou un message d'erreur.

**Points d'attention :** le risque produit n'est pas technique mais lexical — un mot
mal choisi ("chantier" pour un salon de coiffure) suffit à faire perdre un utilisateur
en dix secondes, avant même qu'il ait vu une fonctionnalité.

**Priorité :** Must — c'est la porte d'entrée ; tout le reste du produit est invisible
tant qu'un utilisateur hors BTP rebondit ici.

---

### US-A1.2 — Reprise de l'historique quel que soit le secteur
**Segments :** entreprise déjà en activité qui migre depuis un autre outil, tous
secteurs.
**En tant qu'** entreprise déjà en activité, **je veux** déclarer mon chiffre d'affaires
de l'exercice en cours et mes documents en attente (devis non répondus, factures
impayées) au moment de l'onboarding, **afin que** mes indicateurs soient justes dès le
premier jour sans ressaisie manuelle de mon historique complet.

**Contexte :** une reprise de données mal faite (voir US-A1.2 vs ticket 4.9 existant,
aujourd'hui pensé pour le bâtiment) est ce qui décourage le plus une entreprise déjà
équipée de migrer vers un nouvel outil.

**Critères d'acceptation :**
- Étant donné un utilisateur en cours d'onboarding, quand il atteint l'étape de reprise,
  alors il peut saisir un CA facturé et encaissé à date sans que le formulaire présuppose
  une activité de chantier.
- Étant donné moins de trois documents (devis/prestations) déjà en cours, quand
  l'utilisateur termine cette étape, alors le système affiche "données insuffisantes"
  plutôt qu'un indicateur trompeur basé sur un échantillon trop faible.
- Étant donné une reprise complétée, quand l'utilisateur consulte son compte de
  résultat, alors les montants repris apparaissent bien dans le premier exercice
  affiché.

**Points d'attention :** le seuil de silence (moins de 3 éléments → donnée
insuffisante) existe déjà côté bâtiment ; il doit rester valable pour un commerce ou un
cabinet de conseil sans recalibrage arbitraire par secteur.

**Priorité :** Should — important pour la conversion d'entreprises déjà équipées, mais
non bloquant pour un tout nouvel entrepreneur.

---

### US-A1.3 — Profil entreprise avec formes juridiques variées
**Segments :** micro-entreprise/auto-entrepreneur, profession libérale réglementée
(ordre professionnel), société commerciale classique.
**En tant qu'** utilisateur, **je veux** que mon profil entreprise reconnaisse ma forme
juridique réelle (micro-entreprise, profession libérale avec numéro d'ordre, EURL,
SARL, SAS…) **afin que** mes documents commerciaux portent les mentions légales exactes
correspondant à mon statut, sans avoir à les connaître par cœur.

**Contexte :** les mentions obligatoires diffèrent fortement : un auto-entrepreneur non
assujetti à la TVA doit afficher "TVA non applicable, art. 293 B du CGI" ; une profession
libérale réglementée doit parfois afficher son numéro d'inscription à l'ordre ; une
société doit afficher son capital social et son RCS.

**Critères d'acceptation :**
- Étant donné un profil déclaré "micro-entreprise" avec franchise de TVA, quand une
  facture est émise, alors la mention légale de franchise apparaît automatiquement et
  aucun champ TVA n'est demandé à l'émission.
- Étant donné un profil "profession libérale réglementée", quand l'utilisateur complète
  son profil, alors un champ dédié au numéro d'inscription à l'ordre professionnel est
  disponible et apparaît sur les documents si renseigné.
- Étant donné un profil "société" (SARL/SAS/EURL), quand une facture est émise, alors le
  capital social et le RCS apparaissent si renseignés dans le profil.

**Points d'attention :** ne pas complexifier l'écran pour l'auto-entrepreneur solo, qui
reste la majorité des nouveaux inscrits — les champs spécifiques doivent apparaître
conditionnellement, jamais tous en même temps.

**Priorité :** Must — une mention légale manquante ou fausse est un risque de
conformité immédiat, pas une simple gêne d'usage.

---

### US-A1.4 — Sortie d'essai vers un module sectoriel non encore livré
**Segments :** tout secteur non couvert par un module dédié au moment de l'inscription.
**En tant qu'** utilisateur d'un secteur pas encore spécifiquement outillé (par exemple
agriculture ou événementiel), **je veux** être informé clairement de ce qui est déjà
adapté à mon métier et de ce qui reste générique, **afin de** décider en connaissance de
cause si je continue plutôt que de découvrir plus tard des limites non annoncées.

**Contexte :** promettre implicitement une couverture complète à un secteur non encore
livré crée une déception plus coûteuse commercialement qu'une transparence assumée dès
le départ.

**Critères d'acceptation :**
- Étant donné un secteur sans module dédié, quand l'utilisateur le sélectionne, alors un
  message explicite indique quelles fonctions restent génériques (ex. "la facturation et
  la gestion d'équipe sont disponibles ; les spécificités de votre secteur seront
  ajoutées prochainement").
- Étant donné cette situation, quand l'utilisateur poursuit, alors aucune fonctionnalité
  générique n'est bloquée par l'absence de module sectoriel.
- Étant donné un intérêt exprimé pour un secteur non couvert, quand plusieurs
  utilisateurs le signalent, alors cette donnée remonte de façon exploitable côté
  produit (priorisation du prochain module).

**Points d'attention :** ce mécanisme de remontée d'intérêt est aussi un outil de
priorisation produit — ne pas le construire uniquement comme un message statique.

**Priorité :** Could — utile pour la feuille de route, non bloquant pour l'usage
immédiat.
