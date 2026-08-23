# Module B2 — Commerce & vente au détail

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE B — MODULES SECTORIELS

### US-B2.1 — Encaissement immédiat multi-moyens de paiement
**En tant que** commerçant, **je veux** enregistrer un encaissement immédiat (carte,
espèces, chèque) au moment de la vente plutôt qu'un cycle facture-paiement différé, **afin
de** refléter mon activité réelle sans détour par un processus pensé pour un paiement à
terme.
**Critères d'acceptation :** étant donné une vente au comptoir, alors elle peut être
enregistrée et son paiement rapproché en une seule action ; étant donné un ticket de
caisse, alors il respecte les obligations légales françaises de conservation (NF525 si
applicable au logiciel de caisse).
**Priorité :** Must pour ce module — c'est le mode de fonctionnement de base du
commerce.

### US-B2.2 — Gestion de stock simple liée au catalogue
**En tant que** commerçant, **je veux** que chaque vente décrémente automatiquement mon
stock produit, **afin de** savoir en temps réel ce qu'il me reste sans inventaire manuel
quotidien.
**Critères d'acceptation :** étant donné un produit vendu, alors le stock associé
diminue de la quantité vendue ; étant donné un stock sous un seuil défini, alors une
alerte de réapprovisionnement se déclenche.
**Priorité :** Should — structurant pour ce secteur, mais un commerce peut déjà tirer
profit de la facturation sans cette fonction.

### US-B2.3 — TVA multi-taux par produit
**En tant que** commerçant vendant des produits à taux de TVA différents (alimentaire à
5,5 %, autres produits à 20 %), **je veux** que chaque produit du catalogue porte son
propre taux, **afin de** ne jamais avoir à choisir manuellement le taux à chaque vente.
**Critères d'acceptation :** étant donné un produit créé avec un taux de TVA associé,
alors ce taux s'applique automatiquement à chaque vente de ce produit sans intervention
manuelle.
**Priorité :** Must — erreur de conformité immédiate si absent.

### US-B2.4 — Click & collect / vente à distance simple
**En tant que** commerçant qui propose la réservation en ligne avec retrait en
boutique, **je veux** recevoir une commande client à distance directement dans mon
système, **afin de** préparer la commande sans ressaisir une information reçue par un
autre canal (e-mail, réseau social).
**Critères d'acceptation :** étant donné une commande passée à distance, alors elle
apparaît dans la même liste de commandes que celles prises en boutique ; étant donné son
retrait effectif, alors elle est marquée honorée avec la même traçabilité qu'une vente
comptoir.
**Priorité :** Could — différenciant mais non essentiel à un premier module commerce.
