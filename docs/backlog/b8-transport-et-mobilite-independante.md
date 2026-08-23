# Module B8 — Transport & mobilité indépendante

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE B — MODULES SECTORIELS

### US-B8.1 — Mission unitaire vs contrat de transport récurrent
**En tant que** transporteur indépendant (livraison, déménagement), **je veux**
distinguer une course ponctuelle facturée à l'unité d'un contrat récurrent avec un
client professionnel, **afin d'** adapter mon mode de facturation à chaque situation
sans forcer un modèle unique.
**Critères d'acceptation :** étant donné une mission ponctuelle, alors elle peut être
facturée immédiatement à son terme ; étant donné un contrat récurrent, alors la
facturation périodique du tronc commun (US-A2.3) s'applique.
**Priorité :** Must pour ce module — structure de base de l'activité.

### US-B8.2 — Preuve de livraison numérique
**En tant que** livreur, **je veux** faire signer ou photographier une preuve de
livraison directement depuis mon application, **afin de** disposer d'une preuve
opposable en cas de litige sur la réception de la marchandise.
**Critères d'acceptation :** étant donné une livraison effectuée, alors une signature ou
une photo peut être associée à cette livraison au moment même de sa réalisation ; étant
donné cette preuve, alors elle reste rattachée de façon immuable à la mission concernée.
**Priorité :** Must pour ce module — élément central de la relation de confiance avec le
client dans ce secteur.

### US-B8.3 — Suivi kilométrique et frais de carburant
**En tant que** transporteur indépendant, **je veux** suivre mes kilomètres parcourus et
mes frais de carburant par mission, **afin de** connaître ma marge réelle après ces
coûts variables importants dans mon métier.
**Critères d'acceptation :** étant donné une mission avec un kilométrage renseigné,
alors un coût estimé de carburant peut être calculé selon un barème configurable et
intégré au calcul de marge de la mission.
**Priorité :** Should — impact significatif sur la marge réelle de ce secteur, distinct
des indicateurs génériques du tronc commun.

### US-B8.4 — Conformité réglementaire transport
**En tant que** transporteur, **je veux** que mon profil intègre les documents
réglementaires propres à mon activité (licence de transport, carte professionnelle),
avec suivi de leur date d'expiration, **afin de** ne jamais me retrouver en défaut de
documentation en cas de contrôle routier.
**Critères d'acceptation :** étant donné un document réglementaire enregistré avec une
date d'expiration, alors une alerte est envoyée avant échéance, selon le même mécanisme
que les habilitations du tronc commun (US-A4.4).
**Priorité :** Must pour ce module — obligation légale directement contrôlée sur la
voie publique.
