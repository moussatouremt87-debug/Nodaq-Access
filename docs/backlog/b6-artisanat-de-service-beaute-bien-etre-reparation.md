# Module B6 — Artisanat de service (beauté, bien-être, réparation)

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE B — MODULES SECTORIELS

### US-B6.1 — Prise de rendez-vous en ligne avec confirmation automatique
**En tant que** coiffeur, esthéticienne ou réparateur, **je veux** proposer une prise de
rendez-vous en ligne à mes clients avec confirmation automatique, **afin de** réduire le
temps passé au téléphone à gérer mon agenda.
**Critères d'acceptation :** étant donné des créneaux disponibles publiés, alors un
client peut réserver directement sans intervention du praticien ; étant donné une
réservation confirmée, alors elle apparaît immédiatement dans le planning interne.
**Priorité :** Must pour ce module — c'est le point d'entrée principal de la relation
client dans ce secteur.

### US-B6.2 — Rappel de rendez-vous et réduction du no-show
**En tant que** praticien, **je veux** qu'un rappel automatique soit envoyé au client
avant son rendez-vous, **afin de** réduire les absences non prévenues qui coûtent
directement du chiffre d'affaires perdu.
**Critères d'acceptation :** étant donné un rendez-vous à venir, alors un rappel est
envoyé selon un délai configurable, en respectant la même doctrine de validation humaine
pour tout envoi automatisé sortant.
**Priorité :** Should — fort impact économique direct dans ce secteur à forte
proportion de rendez-vous individuels.

### US-B6.3 — Ticket moyen et fidélisation simple
**En tant que** commerçant de service (coiffure, réparation), **je veux** suivre mon
ticket moyen par client et identifier mes clients réguliers, **afin d'** orienter mes
actions commerciales sans outil de fidélisation séparé.
**Critères d'acceptation :** étant donné l'historique des prestations d'un client, alors
son ticket moyen et sa fréquence de visite sont calculés automatiquement ; étant donné un
client n'étant pas revenu depuis un délai inhabituel pour lui, alors une alerte peut être
proposée pour une relance.
**Priorité :** Could — valeur ajoutée réelle mais non essentielle à un premier usage.

### US-B6.4 — Devis de réparation avec accord préalable du client
**En tant que** réparateur (auto, électroménager, cordonnerie), **je veux** faire
valider un devis de réparation par le client avant d'engager les travaux, **afin de** ne
jamais facturer une intervention non autorisée au préalable.
**Critères d'acceptation :** étant donné un diagnostic réalisé, alors un devis peut être
transmis au client pour accord explicite avant intervention ; étant donné l'absence
d'accord, alors aucune facturation de travaux (hors éventuel forfait de diagnostic) ne
peut être émise.
**Priorité :** Must pour ce module — s'appuie directement sur le mécanisme
d'acceptation publique de devis déjà existant côté bâtiment, transposé tel quel.
