# Epic A5 — Rôles, multi-tenant & délégation comptable

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE A — TRONC COMMUN (toute TPE/PME)

### US-A5.1 — Rôles adaptés à des structures variées
**Segments :** toute structure, y compris les professions libérales en société
d'exercice, les commerces familiaux, les associations d'indépendants.
**En tant qu'** utilisateur, **je veux** que les rôles OWNER/MEMBER/ACCOUNTANT
s'appliquent à ma structure quelle qu'elle soit (société commerciale, société
d'exercice libéral, entreprise individuelle avec conjoint collaborateur), **afin de**
gérer les accès sans devoir contourner un modèle pensé uniquement pour une PME
classique.

**Contexte :** le modèle de rôles actuel est générique dans sa conception
(authentification, appartenance, permissions) — l'enjeu est de vérifier qu'aucune
hypothèse implicite (un seul dirigeant, une seule structure) ne le limite en pratique.

**Critères d'acceptation :**
- Étant donné une société d'exercice libéral à plusieurs associés, quand plusieurs
  utilisateurs ont le rôle OWNER, alors chacun dispose des mêmes droits sans
  hiérarchie implicite non voulue entre eux.
- Étant donné une entreprise individuelle avec conjoint collaborateur, quand ce dernier
  est invité, alors son statut particulier (ni salarié, ni simple observateur) peut être
  reflété sans forcer une catégorie inadaptée.
- Étant donné une structure associative d'indépendants partageant des moyens, quand
  plusieurs entités distinctes coexistent, alors leur isolation multi-tenant reste
  stricte malgré leur proximité opérationnelle.

**Points d'attention :** vérifier qu'aucune règle métier n'impose implicitement "un
seul OWNER" quelque part dans le code — le modèle de données doit déjà le permettre,
mais un test dédié doit le confirmer.

**Priorité :** Should — le socle existe, la vérification d'absence d'hypothèse
implicite est le vrai travail restant.

---

### US-A5.2 — Cabinet comptable multi-secteurs
**Segments :** experts-comptables et cabinets de gestion, tous secteurs de clients
confondus.
**En tant qu'** expert-comptable qui suit des clients de secteurs différents
(un maçon, un restaurateur, un consultant), **je veux** une console qui présente
chaque client avec son vocabulaire et ses indicateurs propres, **afin de** ne pas devoir
réinterpréter mentalement des données présentées de façon uniforme sans distinction
sectorielle.

**Contexte :** la console cabinet (ticket 4.13, encore à construire) doit être pensée
dès sa conception pour un portefeuille de clients multi-sectoriel, pas seulement pour
un cabinet spécialisé bâtiment.

**Critères d'acceptation :**
- Étant donné un cabinet avec des clients de secteurs différents, quand il consulte sa
  liste de clients, alors chaque client affiche des indicateurs cohérents avec son
  propre secteur (pas un modèle unique appliqué uniformément).
- Étant donné un cabinet qui bascule d'un client à un autre, quand il change de
  contexte, alors le vocabulaire affiché change en conséquence sans confusion.
- Étant donné un export comptable, quand il est produit pour plusieurs clients de
  secteurs différents, alors sa structure reste homogène (même plan comptable général)
  malgré la diversité des activités.

**Points d'attention :** cette story dépend directement de A1.1 (secteur déclaré à
l'onboarding) et de A3.2 (compte de résultat générique) — à ne pas planifier avant
elles.

**Priorité :** Should — condition de fond pour que le rôle ACCOUNTANT ait de la valeur
dans un portefeuille réaliste (rarement mono-sectoriel).

---

### US-A5.3 — Invitation d'un collaborateur avec des statuts non standards
**Segments :** apprenti, stagiaire, bénévole (associatif), vacataire.
**En tant qu'** employeur, **je veux** inviter un collaborateur avec un statut qui ne
correspond pas exactement à "salarié" au sens classique (apprenti, stagiaire, vacataire,
bénévole associatif), **afin de** refléter ma réalité RH sans forcer une catégorie
inadaptée qui fausserait mes indicateurs de coût.

**Contexte :** ce besoin dépasse le bâtiment (déjà identifié pour l'apprenti) — un
cabinet de conseil accueille des stagiaires, une association fait appel à des
bénévoles, un commerce à des vacataires saisonniers.

**Critères d'acceptation :**
- Étant donné un statut "stagiaire" ou "apprenti" sélectionné à l'invitation, quand les
  coûts de mission sont calculés, alors la règle de coût appliquée correspond au statut
  réel (souvent réduit ou nul) plutôt qu'à un taux de salarié classique.
- Étant donné un statut "bénévole", quand il est affecté à une mission, alors aucun
  coût salarial n'est comptabilisé, sans pour autant l'exclure du planning.
- Étant donné n'importe quel statut non standard, quand l'accès est révoqué en fin de
  période, alors la révocation suit exactement la même procédure de sécurité qu'un
  salarié classique (pas de traitement dégradé sur la sécurité au prétexte d'un statut
  temporaire).

**Points d'attention :** ne jamais faire de compromis sur la sécurité d'accès sous
prétexte qu'un statut est "temporaire" ou "non essentiel" — la révocation doit rester
aussi rigoureuse.

**Priorité :** Could — utile à un sous-ensemble de secteurs, non bloquant pour le
lancement multi-sectoriel.

---

### US-A5.4 — Accès en lecture seule pour un tiers de confiance
**Segments :** banquier, investisseur, associé minoritaire, avocat en cas de litige —
tous secteurs.
**En tant qu'** entreprise, **je veux** pouvoir donner un accès en lecture seule limité
dans le temps à un tiers de confiance externe à mon équipe (banquier pour un dossier de
financement, avocat pour un contentieux), **afin de** partager l'information nécessaire
sans créer un compte ACCOUNTANT ou MEMBER inadapté à ce besoin ponctuel.

**Contexte :** le rôle ACCOUNTANT est pensé pour une relation durable de gestion
comptable ; un besoin ponctuel et limité dans le temps (dossier bancaire, contentieux)
mérite un mécanisme distinct, plus proche d'un partage sécurisé que d'une invitation
permanente.

**Critères d'acceptation :**
- Étant donné un accès "tiers de confiance" créé avec une date d'expiration, quand cette
  date est atteinte, alors l'accès est révoqué automatiquement sans action manuelle.
- Étant donné cet accès, quand le tiers consulte les données, alors il ne peut à aucun
  moment modifier ou créer une donnée, quelle qu'elle soit.
- Étant donné cet accès actif, quand l'entreprise le révoque manuellement avant
  l'expiration prévue, alors la révocation est immédiate et journalisée.

**Points d'attention :** distinguer clairement ce mécanisme du rôle ACCOUNTANT dans la
documentation utilisateur, pour éviter la confusion entre "délégation comptable
durable" et "partage ponctuel en lecture seule".

**Priorité :** Could — utile mais non structurant pour l'ouverture multi-sectorielle.

---

### US-A5.5 — Visibilité publiée/privée et éditeurs désignés pour un agent
**Segments :** structures à plusieurs OWNER/MEMBER ou avec délégation comptable, tous
secteurs.
**En tant qu'** OWNER, **je veux** décider si un agent ou une automatisation configurée
(par exemple une règle de facturation récurrente ou un modèle de relance) est visible et
modifiable par toute l'équipe, ou réservée à des éditeurs que je désigne explicitement,
**afin de** garder le contrôle sur des automatisations sensibles sans devoir choisir
entre "tout le monde peut tout changer" et "personne d'autre que moi ne peut rien voir".

**Contexte :** une analyse comparative de la plateforme d'agents IA Dust (dust.tt) a
montré que la distinction agent publié (visible à toute l'équipe ayant accès aux
données) / agent privé (créateur + éditeurs désignés) est un mécanisme de gouvernance
simple et efficace pour des équipes multi-rôles. NODAQ dispose déjà d'une structure de
rôles (OWNER/MEMBER/ACCOUNTANT) plus fine que le binaire membre/non-membre — cette story
vise à s'assurer que la future console cabinet (ticket 4.13, US-A5.2) et la gestion des
automatisations en général prévoient ce niveau de granularité dès leur conception plutôt
que de le rajouter après coup.

**Critères d'acceptation :**
- Étant donné une automatisation créée par un OWNER, quand il la configure, alors il
  peut choisir "visible et modifiable par tous les MEMBER" ou "éditeurs désignés
  uniquement", avec une liste explicite d'éditeurs dans ce second cas.
- Étant donné un MEMBER sans droit d'édition sur une automatisation, quand il la
  consulte, alors il peut voir qu'elle existe et ce qu'elle fait, sans pouvoir la
  modifier ni la désactiver.
- Étant donné un changement de liste d'éditeurs désignés, quand il est effectué, alors
  il est journalisé au même titre que toute décision sur une écriture agentique
  (cohérent avec US-A6.4).

**Points d'attention :** ne pas construire ce mécanisme comme une fonctionnalité isolée
mais comme une extension du modèle de rôles existant (`requireRole`) — il doit rester
compatible avec la chaîne d'autorisation `requireAuth → resolveTenant →
requireMembership → withTenant` déjà en place, pas une nouvelle couche parallèle.

**Priorité :** Could pour le tronc commun immédiat, mais à anticiper explicitement dans
la conception de la console cabinet (US-A5.2) pour ne pas devoir la retravailler après
coup.
