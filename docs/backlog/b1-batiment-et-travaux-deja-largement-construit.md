# Module B1 — Bâtiment & travaux (déjà largement construit)

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE B — MODULES SECTORIELS

### US-B1.1 — Autoliquidation de TVA en sous-traitance BTP
**En tant qu'** entreprise générale sous-traitant une partie d'un chantier, **je veux**
que le système applique automatiquement l'autoliquidation de TVA (art. 283-2 nonies du
CGI) sur les factures de sous-traitance BTP, **afin de** ne pas m'exposer à un
redressement fiscal par erreur de régime de TVA.
**Critères d'acceptation :** étant donné une facture marquée sous-traitance BTP entre
deux assujettis, alors la TVA n'est pas facturée par le sous-traitant et la mention
légale d'autoliquidation apparaît ; étant donné une facture standard hors ce cas, alors
la TVA reste calculée normalement.
**Priorité :** Must (déjà en production).

### US-B1.2 — Retenue de garantie sur marché, avec alternative caution à première demande
**En tant qu'** entreprise de travaux sur marché avec retenue de garantie contractuelle,
**je veux** appliquer automatiquement ce pourcentage sur mes factures, ou choisir de le
remplacer par une caution/garantie à première demande d'un établissement financier,
**afin de** respecter l'usage contractuel du secteur tout en préservant ma trésorerie si
je préfère ne pas immobiliser ces fonds.
**Critères d'acceptation :** étant donné un pourcentage de retenue de garantie défini sur
le contrat (plafond légal 5%, loi n°71-584 du 16/07/1971, d'ordre public), alors chaque
facture liée déduit ce montant du net à payer et le consigne distinctement jusqu'à la
levée de la retenue ; étant donné un choix de caution à première demande à la place,
alors le montant correspondant n'est plus déduit du net à payer et le suivi de la
caution (organisme, échéance) est tracé séparément ; étant donné un choix déjà fait,
alors l'entreprise peut le faire évoluer d'un mode à l'autre à tout moment de son choix,
conformément au caractère substituable de cette alternative.
**Priorité :** Must (déjà en production pour la retenue en espèces ; l'alternative
caution est une extension Should — impact direct sur la trésorerie prévisionnelle
US-A3.5).

### US-B1.3 — Assurance décennale mentionnée automatiquement, avec avertissement au poids réel de la sanction
**En tant qu'** entreprise du bâtiment, **je veux** que mes factures de travaux
mentionnent automatiquement mon assureur décennal et le numéro de couverture, **afin
de** respecter l'obligation légale (art. L243-2 du Code des assurances) sans y penser à
chaque émission, et comprendre concrètement ce que je risque si je ne le fais pas.
**Critères d'acceptation :** étant donné une assurance décennale renseignée dans le
profil, alors elle apparaît sur chaque facture de travaux (assureur, adresse, n° de
contrat, zone de couverture) ; étant donné son absence, alors un avertissement non
bloquant s'affiche (contrairement au SIRET qui, lui, bloque), mais son libellé indique
explicitement le risque réel encouru — sanction pénale pouvant aller jusqu'à 6 mois
d'emprisonnement et 75 000 € d'amende (art. L243-3 du Code des assurances) et
responsabilité civile personnelle du dirigeant — plutôt qu'un simple rappel générique
sous-dimensionné par rapport au risque.
**Priorité :** Must (déjà en production pour la mention ; le renforcement du message
d'avertissement est une correction Should, la sanction réelle étant pénale et non
seulement administrative).

### US-B1.4 — Prospection par signaux publics de chantier
**En tant qu'** entreprise du bâtiment, **je veux** être alerté des permis de construire,
marchés publics et attributions récents dans ma zone, **afin de** repérer des
opportunités de chantier avant un concurrent.
**Critères d'acceptation :** étant donné des sources publiques configurées (BOAMP, DECP,
permis de construire), alors des pistes qualifiées apparaissent avec leur source citée ;
étant donné leur absence de configuration, alors l'écran l'explique clairement plutôt
que d'afficher un vide silencieux.
**Priorité :** Should (déjà en production, module de dégradation gracieuse vérifié en
recette).
