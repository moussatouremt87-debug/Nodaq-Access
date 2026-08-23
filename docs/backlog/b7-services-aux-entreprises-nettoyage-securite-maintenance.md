# Module B7 — Services aux entreprises (nettoyage, sécurité, maintenance)

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE B — MODULES SECTORIELS

### US-B7.1 — Contrats multi-sites pour un même client
**En tant qu'** entreprise de nettoyage ou de sécurité, **je veux** gérer un contrat
unique couvrant plusieurs sites d'un même client (plusieurs agences, plusieurs
bâtiments), **afin de** facturer et planifier de façon cohérente sans dupliquer un
contrat par site.
**Critères d'acceptation :** étant donné un contrat multi-sites, alors chaque site
associé peut être planifié et suivi indépendamment tout en remontant à une facturation
consolidée pour le client.
**Priorité :** Must pour ce module — structure contractuelle typique de ce secteur.

### US-B7.2 — Intervention hors horaires standard et astreinte
**En tant qu'** entreprise de maintenance ou de sécurité, **je veux** distinguer une
intervention en horaire standard d'une intervention de nuit, week-end ou en astreinte
d'urgence, **afin d'** appliquer automatiquement une majoration tarifaire conforme à mon
contrat.
**Critères d'acceptation :** étant donné une intervention déclarée hors horaire
standard, alors la majoration contractuelle applicable est appliquée automatiquement à
la facturation correspondante.
**Priorité :** Should — impact direct sur la marge de ce type d'activité, source
d'erreur fréquente en facturation manuelle.

### US-B7.3 — Preuve d'intervention pour un client professionnel
**En tant qu'** entreprise de nettoyage ou de maintenance, **je veux** faire signer une
preuve d'intervention par un responsable du site client à chaque passage, **afin de**
disposer d'une preuve en cas de contestation sur la réalisation effective de la
prestation.
**Critères d'acceptation :** étant donné une intervention terminée, alors une signature
ou une validation du responsable site peut être recueillie sur place ; étant donné cette
preuve recueillie, alors elle reste rattachée de façon immuable à l'intervention et à la
facture qui en découle.
**Priorité :** Should — même besoin que US-B4.4 côté services à la personne, mais avec
un interlocuteur professionnel plutôt qu'un particulier.

### US-B7.4 — Facturation au forfait récurrent avec ajustement de périmètre
**En tant qu'** entreprise de services aux entreprises, **je veux** ajuster le montant
d'un contrat récurrent quand le périmètre change (surface supplémentaire, fréquence
modifiée), **afin de** refléter fidèlement l'évolution du contrat sans le recréer
intégralement.
**Critères d'acceptation :** étant donné un contrat récurrent existant, alors une
modification de périmètre peut être appliquée à partir d'une date donnée sans perdre
l'historique de facturation antérieur au changement.
**Priorité :** Should — enrichit directement US-A2.3 (facturation récurrente générique)
d'un besoin d'évolution de périmètre propre à ce secteur.
