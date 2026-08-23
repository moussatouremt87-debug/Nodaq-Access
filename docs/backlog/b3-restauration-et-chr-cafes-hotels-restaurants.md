# Module B3 — Restauration & CHR (cafés, hôtels, restaurants)

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE B — MODULES SECTORIELS

### US-B3.1 — Addition avec service et pourboire
**En tant que** restaurateur, **je veux** générer une addition qui distingue le montant
du service et un éventuel pourboire volontaire, **afin de** répondre aux usages du
secteur et à leur traitement comptable et social spécifique.
**Critères d'acceptation :** étant donné une addition avec pourboire volontaire déclaré,
alors il est isolé du chiffre d'affaires de vente pour son traitement social propre
(non soumis à la même TVA) ; étant donné son absence, alors l'addition reste standard.
**Priorité :** Must pour ce module — traitement social et fiscal spécifique, source
d'erreur fréquente.

### US-B3.2 — Traçabilité HACCP simplifiée
**En tant que** restaurateur, **je veux** enregistrer facilement mes contrôles de
température et de traçabilité alimentaire obligatoires (HACCP), **afin de** disposer
d'un registre exploitable en cas de contrôle sanitaire, sans outil séparé du reste de ma
gestion.
**Critères d'acceptation :** étant donné un contrôle de température saisi (à l'oral ou
au clavier), alors il est horodaté et conservé sur la durée légale exigée ; étant donné
une anomalie détectée (température hors plage), alors elle est signalée distinctement
dans le registre.
**Priorité :** Should — obligation réglementaire réelle mais non bloquante pour un
premier usage de facturation/gestion.

### US-B3.3 — Réservation et gestion du no-show
**En tant que** restaurateur, **je veux** gérer mes réservations de tables et suivre les
absences non annulées (no-show), **afin de** mieux anticiper mon activité et,
éventuellement, appliquer une politique d'acompte pour les réservations à risque.
**Critères d'acceptation :** étant donné une réservation prise, alors elle apparaît sur
un planning de salle par créneau ; étant donné un no-show enregistré, alors il est
comptabilisé par client pour ajuster une politique de dépôt future si le restaurateur le
souhaite.
**Priorité :** Could — utile mais concurrencé par des outils spécialisés déjà répandus
dans ce secteur.

### US-B3.4 — Menu et carte comme catalogue dynamique
**En tant que** restaurateur, **je veux** gérer ma carte comme un catalogue avec
disponibilité au jour le jour (rupture d'un plat), **afin de** refléter en temps réel ce
que je peux réellement servir, y compris pour une éventuelle commande à distance.
**Critères d'acceptation :** étant donné un plat marqué en rupture, alors il n'apparaît
plus disponible à la commande jusqu'à réactivation manuelle ; étant donné un changement
de carte saisonnier, alors il peut être appliqué en un geste plutôt que produit par
produit.
**Priorité :** Should — cœur du métier restauration, s'appuie sur le catalogue déjà
existant côté tronc commun.
