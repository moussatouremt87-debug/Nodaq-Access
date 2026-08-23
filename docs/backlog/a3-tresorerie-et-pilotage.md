# Epic A3 — Trésorerie & pilotage

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE A — TRONC COMMUN (toute TPE/PME)

### US-A3.1 — Indicateurs adaptés au cycle du secteur
**Segments :** tous secteurs, avec des cycles de trésorerie très différents (paiement
immédiat en commerce/restauration vs délai à 30-60 jours en B2B/conseil vs saisonnalité
en agriculture/paysage).
**En tant qu'** utilisateur, **je veux** que mes indicateurs de trésorerie reflètent le
cycle réel de mon secteur (encaissement immédiat vs délai de paiement, activité stable
vs saisonnière), **afin de** ne pas être alerté à tort ou rassuré à tort par un
indicateur calibré pour un autre modèle d'affaires.

**Contexte :** un commerce qui encaisse comptant n'a pas les mêmes signaux d'alerte
qu'une entreprise de conseil qui facture à 30 jours net ; un indicateur unique et non
paramétré produirait de faux positifs ou de faux négatifs selon le secteur.

**Critères d'acceptation :**
- Étant donné un profil "commerce" avec encaissement majoritairement immédiat, quand
  les indicateurs sont calculés, alors le délai de paiement client n'est pas mis en
  avant comme indicateur principal (peu pertinent pour ce modèle).
- Étant donné un profil "conseil" ou "B2B" avec délai de paiement standard, quand une
  facture dépasse ce délai, alors une alerte est déclenchée selon le seuil réellement
  pertinent pour ce secteur.
- Étant donné un profil à activité saisonnière, quand une comparaison de performance
  est affichée, alors elle se fait par défaut sur la même période de l'année précédente
  plutôt que sur le mois précédent.

**Points d'attention :** éviter de multiplier les tableaux de bord par secteur — un
même moteur d'indicateurs, avec une sélection et des seuils par défaut différents selon
le profil déclaré.

**Priorité :** Should — l'indicateur existe déjà pour le bâtiment ; l'enjeu est sa
pertinence hors bâtiment, pas sa création ex nihilo.

---

### US-A3.2 — Compte de résultat exploitable par tout expert-comptable
**Segments :** toute entreprise avec un expert-comptable, tous secteurs.
**En tant qu'** utilisateur, **je veux** un compte de résultat structuré selon un plan
comptable standard, **afin que** n'importe quel expert-comptable, quel que soit son
secteur de spécialisation, puisse l'exploiter sans reformatage.

**Contexte :** cette fonctionnalité existe déjà et fonctionne bien (six exercices,
export CSV/PDF) — l'enjeu ici est de vérifier qu'elle n'a pas silencieusement absorbé
des postes comptables typés bâtiment (sous-traitance, retenue de garantie) qui
n'auraient pas de sens ailleurs.

**Critères d'acceptation :**
- Étant donné un profil hors bâtiment, quand le compte de résultat est généré, alors
  aucun poste spécifiquement bâtiment (sous-traitance BTP, retenue de garantie)
  n'apparaît s'il n'a jamais été utilisé.
- Étant donné un secteur avec des postes propres (par exemple achats de marchandises
  pour un commerce), quand le compte de résultat est généré, alors ces postes
  apparaissent correctement classés selon le plan comptable général.
- Étant donné un export CSV, quand il est ouvert dans un tableur, alors sa structure
  reste identique quel que soit le secteur déclaré — seule la présence ou l'absence de
  certaines lignes varie selon l'activité réelle.

**Points d'attention :** distinguer clairement "poste non affiché car jamais utilisé"
de "poste supprimé pour ce secteur" — le second cas serait une régression si
l'entreprise change d'activité en cours de vie.

**Priorité :** Must — la comptabilité est un point de non-retour ; une erreur ici a un
impact légal direct.

---

### US-A3.3 — Seuil de rentabilité générique
**Segments :** tous secteurs — le calcul existe déjà pour le bâtiment (impact d'une
embauche sur le seuil).
**En tant qu'** entreprise, **je veux** connaître mon seuil de rentabilité recalculé
automatiquement à chaque changement de charge fixe (embauche, nouvel abonnement,
nouveau local), **afin de** décider en connaissance de cause, quel que soit mon
secteur.

**Contexte :** le calcul de seuil de rentabilité (charges fixes / taux de marge sur
coûts variables) est un calcul générique de gestion, sans aucune spécificité bâtiment —
seul l'exemple actuel (embauche d'un salarié) est illustré avec un vocabulaire chantier.

**Critères d'acceptation :**
- Étant donné une charge fixe nouvelle déclarée (salaire, loyer, abonnement), quand elle
  est enregistrée, alors le seuil de rentabilité se recalcule sans action supplémentaire
  de l'utilisateur.
- Étant donné un profil hors bâtiment, quand le seuil de rentabilité est affiché, alors
  le vocabulaire utilisé reste générique ("chiffre d'affaires nécessaire pour couvrir vos
  charges") plutôt que spécifique à un contexte de chantier.
- Étant donné un secteur à marge variable selon la ligne de produit (commerce), quand le
  seuil est calculé, alors il s'appuie sur une marge moyenne pondérée plutôt que sur un
  taux unique arbitraire.

**Points d'attention :** vérifier le libellé exact affiché à l'écran — un simple mot
mal choisi peut donner l'impression d'un outil non pensé pour son secteur, même quand
le calcul sous-jacent est correct.

**Priorité :** Should — utile à tout secteur, déjà largement construit côté moteur.

---

### US-A3.4 — Alerte d'impayé générique
**Segments :** tous secteurs facturant à terme.
**En tant qu'** utilisateur, **je veux** être alerté automatiquement quand une facture
dépasse son délai de paiement contractuel, quel que soit ce délai (comptant, 30 jours,
60 jours), **afin de** relancer avant que ma trésorerie ne se dégrade, quel que soit mon
secteur.

**Contexte :** cette fonctionnalité existe déjà pour le bâtiment sous une forme
générique — l'enjeu est de confirmer qu'elle fonctionne avec des délais très courts
(commerce, restauration) sans faux positifs.

**Critères d'acceptation :**
- Étant donné une facture avec un délai de paiement à zéro jour (comptant), quand elle
  n'est pas réglée le jour même, alors une alerte adaptée à ce contexte se déclenche
  (distincte d'un délai standard à 30 jours).
- Étant donné une facture à délai standard, quand le délai est dépassé, alors une
  alerte est déclenchée avec un message adapté (relance amiable avant mise en demeure).
- Étant donné une facture réglée avant l'échéance, quand le paiement est enregistré,
  alors aucune alerte n'est déclenchée, quel que soit le secteur.

**Points d'attention :** un commerce qui encaisse comptant n'a normalement aucune
facture "en attente" au sens B2B — vérifier que le système ne génère pas d'alertes
absurdes sur ce type de profil.

**Priorité :** Should — déjà largement construit, vérification de généricité
nécessaire.

---

### US-A3.5 — Prévisionnel de trésorerie
**Segments :** tous secteurs, en particulier ceux à cycle de paiement long (B2B,
conseil, bâtiment) où l'écart entre facturation et encaissement crée un risque de
trésorerie difficile à anticiper à l'œil.
**En tant qu'** entreprise, **je veux** une projection de ma trésorerie sur les
prochaines semaines à partir de mes factures émises, encours et charges récurrentes
connues, **afin d'**anticiper un creux avant qu'il ne devienne un problème, plutôt que de
le constater après coup sur mon relevé bancaire.

**Contexte :** un baromètre Bpifrance Le Lab/Rexecode (T4 2025) constate que 36% des
dirigeants rapportent une dégradation de trésorerie sur 3 mois et 22% des PME/TPE ont des
difficultés à financer leur besoin de trésorerie court terme — la tension de trésorerie
est un phénomène macro en hausse, pas un cas isolé. Une analyse des concurrents directs
montre que même un acteur bien noté comme Tiime (4,8/5) est cité par ses propres
utilisateurs comme n'ayant pas de prévisionnel de trésorerie — c'est un manque répandu
sur ce segment de marché, pas une fonctionnalité déjà standard qu'il suffirait d'égaler.

**Critères d'acceptation :**
- Étant donné les factures émises non encore payées, les échéances de facturation
  récurrente à venir (US-A2.3) et les charges fixes connues, quand le prévisionnel est
  calculé, alors il projette un solde de trésorerie estimé semaine par semaine sur un
  horizon d'au moins 8 semaines.
- Étant donné une facture qui dépasse son délai de paiement habituel sans être réglée,
  quand le prévisionnel est recalculé, alors son encaissement est repoussé dans la
  projection plutôt que maintenu à la date d'échéance contractuelle initiale, pour éviter
  un optimisme trompeur.
- Étant donné un solde projeté qui descendrait sous un seuil défini par l'utilisateur
  (ou un seuil par défaut prudent), quand cette situation est détectée, alors une alerte
  est déclenchée suffisamment en amont pour permettre une action (relance, décalage de
  charge, financement court terme).

**Points d'attention :** ne pas présenter une projection comme une certitude — afficher
explicitement une fourchette ou un niveau de confiance, en particulier pour les tenants
récemment inscrits avec peu d'historique (croiser avec le seuil de silence déjà défini en
US-A1.2).

**Priorité :** Should — non bloquant pour un premier usage, mais identifié comme un
différenciateur commercial concret face à des concurrents directs déjà bien installés.
