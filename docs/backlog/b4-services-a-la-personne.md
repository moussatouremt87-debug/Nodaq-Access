# Module B4 — Services à la personne

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE B — MODULES SECTORIELS

### US-B4.1 — Attestation fiscale annuelle automatique, générée en masse avant l'échéance
**En tant qu'** entreprise de services à la personne, **je veux** générer
automatiquement l'attestation fiscale annuelle permettant à mes clients de bénéficier du
crédit d'impôt de 50 %, pour l'ensemble de mes clients en une seule fois avant
l'échéance légale, **afin de** répondre à une obligation réglementaire et à une attente
forte de ma clientèle particulière, sans traitement manuel client par client ni risque
d'oubli de dernière minute.
**Critères d'acceptation :** étant donné l'ensemble des prestations facturées à chaque
client sur une année civile, alors une attestation récapitulative conforme au format
attendu par l'administration fiscale peut être générée en masse pour tous les clients
d'un tenant en une seule action, avant le **31 mars de l'année suivante** (échéance
légale d'envoi aux clients) ; étant donné l'approche de cette échéance, alors un rappel
proactif est adressé au tenant s'il n'a pas encore lancé la génération.
**Priorité :** Must pour ce module — condition de compétitivité commerciale directe
dans ce secteur (le client final choisit souvent son prestataire en fonction de cette
capacité), avec une échéance légale précise et récurrente chaque année.

### US-B4.2 — Distinction mandataire / prestataire
**En tant qu'** entreprise de services à la personne, **je veux** que le système
distingue mon mode d'intervention (mandataire, où le client reste l'employeur légal, ou
prestataire, où j'emploie directement), **afin que** ma facturation et mes bulletins de
paie reflètent le bon régime juridique.
**Critères d'acceptation :** étant donné un mode "prestataire" déclaré, alors la
facturation suit le circuit standard entreprise-client ; étant donné un mode
"mandataire", alors le document produit reflète que l'entreprise facture une prestation
d'intermédiation, pas directement le service rendu.
**Point d'attention :** le CESU (chèque emploi service universel) est un simple moyen de
paiement complémentaire, pas une obligation légale d'acceptation pour l'entreprise — ne
pas présenter son acceptation comme une contrainte réglementaire dans l'interface ou la
documentation, c'est un choix commercial du tenant.
**Priorité :** Must pour ce module — erreur de régime juridique aux conséquences
sociales et fiscales significatives.

### US-B4.3 — Intervention récurrente chez un particulier
**En tant qu'** entreprise de ménage ou de garde d'enfants, **je veux** planifier une
intervention récurrente chez un même client particulier (chaque semaine, même jour),
**afin de** ne pas reconstruire une planification identique à chaque fois.
**Critères d'acceptation :** étant donné une intervention marquée récurrente, alors elle
se reproduit automatiquement selon la fréquence définie, avec possibilité d'exception
ponctuelle (absence, jour férié) sans casser la récurrence future.
**Priorité :** Should — s'appuie directement sur la facturation récurrente du tronc
commun (US-A2.3), adaptée à une fréquence hebdomadaire fine.

### US-B4.4 — Justificatif d'intervention signé sur place
**En tant qu'** intervenant à domicile, **je veux** faire signer un justificatif de
passage par le client ou un proche à la fin de chaque intervention, **afin de** disposer
d'une preuve en cas de litige sur la réalité ou la durée de la prestation.
**Critères d'acceptation :** étant donné une intervention terminée, alors une signature
peut être recueillie sur l'appareil mobile de l'intervenant ; étant donné cette
signature recueillie, alors elle est rattachée de façon immuable à l'intervention
concernée.
**Priorité :** Could — utile pour la confiance client, non bloquant pour la facturation
de base.
