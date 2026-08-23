# Backlog produit — préambule

> Extrait du backlog v3 (16/08/2026), éclaté le 23/08/2026. Ce fichier porte
> le cadrage commun ; les stories vivent dans les fichiers d'epic et de module.

> Rédigé côté product owner. Correction de cadrage par rapport à la v1 : NODAQ n'est pas
> un outil pour le bâtiment qui pourrait accessoirement servir ailleurs — c'est une
> plateforme d'employés virtuels pour les TPE/PME françaises en général, dont le bâtiment
> est le premier secteur construit. Ce document sépare donc ce qui doit être vrai pour
> **toute** entreprise (tronc commun) de ce qui change selon le métier (modules
> sectoriels), et détaille chaque story avec des critères d'acceptation vérifiables.

---

## Comment lire ce document

- **Tronc commun** : fonctions qu'un boulanger, un consultant, un infirmier libéral et un
  maçon utilisent tous, sous une forme identique ou paramétrable. C'est le socle qui doit
  rester généraliste — toute logique spécifique au bâtiment qui s'y serait glissée
  (décennale, autoliquidation TVA, retenue de garantie…) est un signal d'alerte à
  déplacer vers le module Bâtiment.
- **Modules sectoriels** : ce qui distingue réellement un secteur — vocabulaire,
  obligations légales propres, mode de facturation, contraintes métier. Chaque module
  n'a que 4 stories : ce sont les points de divergence les plus significatifs, pas une
  liste exhaustive.
- Chaque story suit le format : **En tant que / Je veux / Afin de**, un **contexte**
  qui justifie le besoin, des **critères d'acceptation** vérifiables (Étant donné /
  Quand / Alors), un ou des **points d'attention**, et une **priorité** MoSCoW motivée.

## Nouveautés v3

Cette version intègre les points prioritaires issus de deux recherches externes menées le
14/08/2026 (voir `memo-recherche-conformite-et-voix-terrain.md` et
`analyse-dust-value-offer.md`) :

- **US-A2.6 (nouvelle, Must)** — conformité à la réforme de facturation électronique
  obligatoire, angle mort complet de la v2 alors que la première échéance légale
  (réception obligatoire) tombe le 1er septembre 2026.
- **US-B1.2 et US-B1.3 (mises à jour)** — ajout du choix retenue de garantie/caution à
  première demande, et renforcement du message de risque décennale (sanction pénale
  réelle, pas un simple rappel).
- **US-B4.1 (mise à jour)** — ajout de l'échéance légale précise (31 mars) et de la
  génération en masse proactive.
- **US-B9.4 (mise à jour)** — contrainte technique dure sur les champs RDV/patient, la
  frontière HDS/non-HDS n'étant tranchée par aucun texte officiel identifié.
- **US-A3.5 (nouvelle, Should)** — prévisionnel de trésorerie positionné comme
  différenciateur explicite face aux concurrents directs (Tiime notamment, bien noté mais
  sans cette fonction).
- **US-A6.5 (nouvelle, Should)** — gain de temps chiffré affiché après chaque action
  d'agent, inspiré du positionnement marketing de Dust ("vendre du temps rendu, pas des
  fonctionnalités") mais appliqué directement dans le produit plutôt qu'en marketing
  seul.
- **US-A5.5 (nouvelle, Could)** — granularité "publié / privé + éditeurs désignés" pour
  les agents et actions en attente, à prévoir dans la conception de la future console
  cabinet (ticket 4.13).

---
