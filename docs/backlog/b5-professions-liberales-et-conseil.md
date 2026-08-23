# Module B5 — Professions libérales & conseil

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE B — MODULES SECTORIELS

### US-B5.1 — Note d'honoraires avec mentions professionnelles
**En tant que** professionnel libéral, **je veux** que mon document de facturation
porte le nom "note d'honoraires" et les mentions propres à ma profession réglementée
(numéro d'ordre, assurance responsabilité civile professionnelle), **afin de** respecter
les usages et obligations de ma profession.
**Critères d'acceptation :** étant donné un profil "profession libérale réglementée",
alors le document généré porte le vocabulaire et les mentions attendues par l'ordre
professionnel concerné, sans configuration manuelle répétée à chaque émission.
**Priorité :** Must pour ce module — condition de crédibilité professionnelle et de
conformité ordinale.

### US-B5.2 — Confidentialité renforcée des échanges avec l'assistant IA
**En tant que** professionnel soumis à une obligation de confidentialité (avocat,
consultant sous clause de confidentialité), **je veux** une garantie explicite que le
contenu de mes échanges avec l'assistant IA concernant un dossier client ne sort jamais
du périmètre souverain et n'est jamais utilisé à d'autres fins, **afin de** ne pas
engager ma responsabilité professionnelle en utilisant l'outil.
**Critères d'acceptation :** étant donné un échange avec l'assistant portant sur un
dossier client, alors son traitement suit strictement la même doctrine que toute donnée
classée confidentielle, avec une revue spécifique documentée pour ce module.
**Priorité :** Must avant tout déploiement à des professions réglementées à secret
professionnel.

### US-B5.3 — Facturation au forfait avec jalons de mission
**En tant que** consultant, **je veux** découper une mission au forfait en plusieurs
jalons facturables (démarrage, livrable intermédiaire, fin de mission), **afin de**
lisser ma trésorerie sur une mission longue sans attendre son achèvement complet.
**Critères d'acceptation :** étant donné une mission avec des jalons définis, alors
chaque jalon atteint peut déclencher une facturation partielle liée au même contrat
d'origine ; étant donné l'ensemble des jalons facturés, alors leur somme correspond
exactement au montant total du contrat.
**Priorité :** Should — s'appuie sur la même logique que l'acompte échelonné du
bâtiment (US-A2.3), adaptée au vocabulaire du conseil.

### US-B5.4 — Suivi du temps facturable vs non facturable
**En tant que** consultant, **je veux** distinguer dans mon suivi d'activité le temps
facturable au client du temps non facturable (avant-vente, formation interne,
administratif), **afin de** connaître mon taux d'occupation réel et ajuster mon tarif
horaire en conséquence.
**Critères d'acceptation :** étant donné une activité enregistrée, alors elle est
marquée facturable ou non facturable ; étant donné un indicateur de taux d'occupation,
alors il se calcule sur la base de cette distinction plutôt que sur le temps total
enregistré.
**Priorité :** Should — enrichit l'US-A2.4 (facturation au temps passé) d'un indicateur
de pilotage propre à ce secteur.
