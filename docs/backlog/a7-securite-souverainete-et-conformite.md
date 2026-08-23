# Epic A7 — Sécurité, souveraineté & conformité

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE A — TRONC COMMUN (toute TPE/PME)

### US-A7.1 — Mentions légales automatiques selon la réglementation du secteur
**Segments :** tous secteurs à mention légale spécifique (santé : numéro RPPS/ADELI ;
bâtiment : décennale ; profession réglementée : numéro d'ordre).
**En tant qu'** utilisateur, **je veux** que les mentions légales obligatoires sur mes
documents s'adaptent à mon secteur réglementé, **afin de** rester conforme sans devoir
connaître par cœur les textes qui s'appliquent à ma profession.

**Contexte :** cette logique existe déjà pour le bâtiment (SIRET obligatoire, décennale
recommandée) — l'enjeu est de généraliser le mécanisme de "mentions obligatoires par
profil" à d'autres réglementations sectorielles, sans dupliquer le moteur de blocage.

**Critères d'acceptation :**
- Étant donné un profil de profession de santé réglementée, quand un document est émis,
  alors les mentions propres à cette profession (numéro d'identification
  professionnelle) sont vérifiées selon la même doctrine que le SIRET pour le bâtiment.
- Étant donné une mention obligatoire manquante et bloquante pour le secteur concerné,
  quand l'émission est tentée, alors elle est refusée avec un message explicite,
  identique dans sa forme au blocage SIRET déjà existant.
- Étant donné un secteur sans obligation de mention spécifique au-delà du socle commun
  (SIRET, TVA), quand un document est émis, alors aucune vérification superflue ne
  bloque l'émission.

**Points d'attention :** le moteur de vérification des mentions obligatoires
(`auditMentionsFR` côté bâtiment) doit être généralisé en un système déclaratif par
secteur, pas réécrit secteur par secteur.

**Priorité :** Must pour tout secteur réglementé — un manquement ici expose
directement l'utilisateur final, pas seulement NODAQ.

---

### US-A7.2 — Confidentialité renforcée pour les secteurs à secret professionnel
**Segments :** santé, droit, et plus généralement toute profession soumise à un secret
professionnel légal.
**En tant qu'** utilisateur soumis à un secret professionnel légal (santé, droit), **je
veux** une garantie explicite que les informations sensibles de mes clients (données de
santé, éléments de dossier) ne transitent jamais vers un traitement qui ne serait pas
strictement nécessaire, **afin de** ne pas engager ma responsabilité professionnelle en
utilisant l'outil.

**Contexte :** la doctrine de classification des données ("confidentiel" jamais hors
tier souverain) existe déjà dans l'architecture — l'enjeu est de vérifier qu'elle
couvre correctement des catégories de données spécifiques (données de santé, secret
professionnel) qui ont un régime juridique plus strict que la donnée client standard du
bâtiment.

**Critères d'acceptation :**
- Étant donné une donnée relevant du secret professionnel (santé, droit), quand elle
  est saisie dans l'application, alors elle suit au minimum le même niveau de
  classification que les données "confidentiel" déjà définies, avec une revue
  spécifique pour vérifier qu'aucun traitement (y compris analytique ou IA) n'y accède
  sans nécessité stricte.
- Étant donné un incident de sécurité touchant potentiellement ce type de donnée, quand
  il est détecté, alors la procédure de notification suit un délai et un formalisme
  conformes aux obligations spécifiques du secteur (au-delà du délai CNIL générique de
  72h si la réglementation sectorielle est plus stricte).
- Étant donné ce type de donnée, quand un export ou une suppression est demandé, alors
  la même garantie d'effacement complet (y compris données dérivées) s'applique que pour
  toute donnée personnelle.

**Points d'attention :** ne jamais déployer un secteur à secret professionnel renforcé
(santé notamment) sans revue juridique dédiée préalable — cette story documente un
besoin produit, elle ne remplace pas une validation légale spécifique au secteur de
santé.

**Priorité :** Must avant tout déploiement en secteur de santé ou juridique ; sans objet
tant que ces secteurs ne sont pas ouverts.

---

### US-A7.3 — Authentification adaptée à des équipes à fort turnover
**Segments :** restauration, commerce, services à la personne — secteurs à fort
turnover saisonnier ou structurel.
**En tant qu'** employeur dans un secteur à fort turnover, **je veux** que la création
et la révocation d'accès pour un nouveau salarié saisonnier soient rapides sans jamais
sacrifier la rigueur de sécurité (MFA, validation), **afin de** rester opérationnel
malgré un renouvellement fréquent de personnel sans multiplier les comptes orphelins.

**Contexte :** un secteur qui embauche et libère du personnel plusieurs fois par
saison (restauration, commerce de Noël, paysage en été) a un besoin de rotation des
accès bien plus fréquent qu'une entreprise du bâtiment à équipe stable.

**Critères d'acceptation :**
- Étant donné un nouveau salarié saisonnier invité, quand il accepte l'invitation, alors
  la création de compte et l'enrôlement MFA restent aussi rapides que pour tout autre
  profil, sans étape supplémentaire liée à la saisonnalité.
- Étant donné une fin de contrat saisonnier, quand elle est enregistrée, alors la
  révocation d'accès peut être anticipée à une date connue à l'avance (fin de contrat)
  sans attendre une action manuelle le jour même.
- Étant donné un volume important de créations et révocations sur une courte période,
  quand elles ont lieu, alors le système ne dégrade pas ses performances ni ne
  contourne silencieusement une étape de sécurité pour absorber le volume.

**Points d'attention :** la révocation programmée à l'avance (US ci-dessus) est
différente d'une simple révocation immédiate déjà existante — elle nécessite une vraie
fonctionnalité de planification, pas seulement une action manuelle plus rapide.

**Priorité :** Should — important pour l'adoption dans les secteurs à forte
saisonnalité RH, non bloquant pour un premier déploiement.

---

### US-A7.4 — Garantie de souveraineté explicite et vérifiable
**Segments :** tous secteurs, en particulier ceux traitant des données sensibles
(santé, juridique) ou des marchés publics soumis à des clauses de souveraineté.
**En tant qu'** utilisateur, **je veux** pouvoir démontrer à mon propre client ou à un
donneur d'ordre public que mes données restent hébergées en France et que le
traitement IA ne sort jamais du territoire, **afin de** répondre à des exigences
contractuelles ou d'appel d'offres qui l'exigent explicitement.

**Contexte :** cette exigence est actuellement documentée en interne (blueprint,
architecture Scaleway fr-par) mais pas nécessairement formalisée comme un document que
l'utilisateur final peut lui-même produire à un donneur d'ordre.

**Critères d'acceptation :**
- Étant donné une demande de preuve de souveraineté, quand l'utilisateur la formule,
  alors un document standard (attestation d'hébergement, sous-traitants du DPA) est
  disponible sans nécessiter une demande manuelle au support à chaque fois.
- Étant donné une réponse à un marché public avec clause de souveraineté, quand
  l'utilisateur prépare son dossier, alors il peut joindre cette attestation directement
  depuis l'application.
- Étant donné une évolution de l'infrastructure (changement de sous-traitant modèle,
  par exemple), quand elle a lieu, alors cette attestation est automatiquement mise à
  jour plutôt que de devenir silencieusement obsolète.

**Points d'attention :** ce document doit rester synchronisé avec la réalité technique
(DPA, annexe des sous-traitants) — un document marketing déconnecté de l'architecture
réelle serait pire qu'une absence de document.

**Priorité :** Should — différenciant commercial fort pour les secteurs sensibles aux
marchés publics ou à la donnée réglementée.
