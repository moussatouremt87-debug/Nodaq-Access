# Epic A4 — Équipe, planning & disponibilités

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE A — TRONC COMMUN (toute TPE/PME)

### US-A4.1 — Pointage adapté à des métiers sans "chantier"
**Segments :** tout secteur avec des salariés dont l'activité ne se découpe pas en
chantiers (vendeur en boutique, serveur, aide à domicile, assistant de cabinet).
**En tant qu'** employeur, **je veux** pointer les heures de mes salariés par
créneau ou par mission plutôt que par "chantier", **afin de** refléter la réalité de
mon activité sans vocabulaire inadapté.

**Contexte :** le pointage actuel est pensé pour une affectation à un chantier
identifiable ; un grand nombre de secteurs (commerce, restauration, service à domicile)
fonctionne par créneau horaire ou par client visité, pas par chantier.

**Critères d'acceptation :**
- Étant donné un profil hors bâtiment, quand un salarié pointe ses heures, alors
  l'unité de rattachement proposée est un créneau, un client ou une mission plutôt
  qu'un "chantier".
- Étant donné une intervention chez un client à domicile, quand elle est pointée, alors
  elle peut être rattachée à ce client sans devoir créer un "chantier" fictif pour
  contourner l'interface.
- Étant donné un calcul de coût de revient, quand il agrège les pointages, alors le
  résultat est identique quel que soit le vocabulaire d'unité utilisé (chantier,
  créneau, mission).

**Points d'attention :** le mot "chantier" pourrait être en dur dans plusieurs écrans
et libellés backend — un audit lexical dédié est nécessaire avant de considérer cette
story terminée.

**Priorité :** Must — sans ce changement, la gestion d'équipe reste littéralement
inutilisable hors bâtiment.

---

### US-A4.2 — Planning avec prise de rendez-vous client
**Segments :** secteurs à rendez-vous (coiffure, santé libérale, conseil, réparation).
**En tant qu'** utilisateur dont l'activité fonctionne par rendez-vous plutôt que par
chantier planifié en interne, **je veux** un planning qui inclut la prise de
rendez-vous avec un client final, **afin de** gérer mon activité sans outil de
prise de rendez-vous séparé.

**Contexte :** le planning actuel organise des équipes sur des chantiers ; une part
importante des TPE/PME (santé, beauté, conseil, réparation) a plutôt besoin de gérer des
créneaux proposés à des clients, avec confirmation et rappel.

**Critères d'acceptation :**
- Étant donné un profil à rendez-vous, quand l'utilisateur configure ses disponibilités,
  alors un client peut visualiser les créneaux libres selon une règle définie par
  l'utilisateur.
- Étant donné un rendez-vous pris, quand l'échéance approche, alors un rappel peut être
  envoyé au client (selon la même doctrine de validation humaine pour tout envoi
  automatisé).
- Étant donné une annulation tardive, quand elle est enregistrée, alors elle est
  distinguée d'un rendez-vous honoré dans les statistiques du praticien.

**Points d'attention :** ceci est une fonctionnalité potentiellement lourde à
construire (gestion de créneaux publics, annulation, rappel) — à ne pas sous-estimer
dans l'estimation de complexité malgré sa formulation simple.

**Priorité :** Could au niveau du tronc commun — plus probablement un module
sectoriel dédié (beauté/bien-être, santé) qu'une fonction generic à construire
immédiatement.

---

### US-A4.3 — Gestion de la capacité incluant des profils non-salariés
**Segments :** tous secteurs faisant appel à des indépendants, intérimaires ou
prestataires externes.
**En tant qu'** employeur, **je veux** inclure dans mes coûts de production les
prestataires externes (indépendants, intérimaires, sous-traitants) sans qu'ils
comptent dans ma capacité RH interne, **afin de** garder des indicateurs RH fidèles à
ma structure réelle tout en connaissant mon coût complet.

**Contexte :** cette distinction existe déjà pour le bâtiment (sous-traitant compté
dans le coût, jamais dans la capacité) — le principe est générique et vaut pour un
consultant qui fait appel à un freelance ou un restaurant qui fait appel à un extra.

**Critères d'acceptation :**
- Étant donné un prestataire externe affecté à une mission, quand le coût de la mission
  est calculé, alors son coût est inclus.
- Étant donné le même prestataire, quand la capacité d'équipe est calculée (jours
  disponibles par semaine), alors il n'est pas compté comme un salarié.
- Étant donné un changement de statut (un prestataire externe devient salarié), quand ce
  changement est enregistré, alors les indicateurs historiques ne sont pas recalculés
  rétroactivement de façon incohérente.

**Points d'attention :** la règle "coût inclus, capacité exclue" doit rester
identique quel que soit le secteur — c'est un principe de gestion, pas une règle
bâtiment.

**Priorité :** Should — la logique existe déjà, l'enjeu est sa généralisation
lexicale et son exposition hors module bâtiment.

---

### US-A4.4 — Compétences et habilitations par secteur
**Segments :** tous secteurs à habilitation réglementée (santé, sécurité, transport,
BTP avec habilitations électriques).
**En tant qu'** employeur, **je veux** enregistrer les habilitations ou qualifications
requises de mes salariés (permis, habilitation électrique, diplôme d'État, carte
professionnelle) **afin de** ne jamais affecter une personne non habilitée à une
mission qui l'exige, et de suivre les dates d'expiration.

**Contexte :** ce besoin dépasse largement le bâtiment (habilitation électrique) — il
concerne le transport (permis, carte conducteur), la santé (diplôme, autorisation
d'exercice), la sécurité privée (carte professionnelle).

**Critères d'acceptation :**
- Étant donné un salarié avec une habilitation enregistrée et une date d'expiration,
  quand cette date approche, alors une alerte est envoyée à l'employeur avant
  expiration.
- Étant donné une mission nécessitant une habilitation précise, quand l'employeur tente
  d'affecter un salarié qui ne la détient pas, alors une alerte visible s'affiche
  (avertissement, pas nécessairement un blocage strict pour rester flexible).
- Étant donné plusieurs types d'habilitations possibles selon le secteur, quand le
  profil sectoriel est configuré, alors la liste d'habilitations proposée s'adapte au
  secteur déclaré.

**Points d'attention :** ne pas transformer ceci en blocage strict par défaut — le
produit doit avertir, pas décider à la place de l'employeur, sauf obligation légale
stricte à documenter secteur par secteur.

**Priorité :** Should — risque réglementaire réel dans plusieurs secteurs (transport,
santé, sécurité), à ne pas laisser à Could par confort de planification.
