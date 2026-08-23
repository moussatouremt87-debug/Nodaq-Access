# Epic A6 — Assistant IA & validation humaine

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE A — TRONC COMMUN (toute TPE/PME)

### US-A6.1 — Vocabulaire de l'assistant adapté au secteur
**Segments :** tous secteurs.
**En tant qu'** utilisateur, **je veux** que l'assistant IA me parle avec le
vocabulaire de mon métier (mission, rendez-vous, prestation, plutôt que "chantier"
systématique), **afin de** ne pas avoir l'impression de m'adresser à un outil pensé
pour un autre secteur que le mien.

**Contexte :** l'assistant vocal existe et fonctionne déjà (dictée de devis, validation
d'écriture) — l'enjeu ici est le paramétrage de son vocabulaire de sortie, pas sa
capacité technique sous-jacente.

**Critères d'acceptation :**
- Étant donné un profil sectoriel déclaré, quand l'assistant formule une réponse, alors
  le vocabulaire employé correspond au secteur (mission pour un consultant, rendez-vous
  pour un praticien, chantier pour le bâtiment).
- Étant donné une action proposée par l'assistant, quand elle est affichée pour
  validation, alors son libellé reste compréhensible sans connaissance du jargon d'un
  autre secteur.
- Étant donné un changement de secteur déclaré (cas rare mais possible), quand il a
  lieu, alors le vocabulaire de l'assistant s'ajuste sans redémarrage ni configuration
  manuelle supplémentaire.

**Points d'attention :** ce paramétrage doit vivre dans une couche de configuration
séparée du modèle de langage lui-même, pour ne pas nécessiter un réentraînement à
chaque nouveau secteur ajouté.

**Priorité :** Should — améliore fortement l'adoption hors bâtiment sans remettre en
cause l'architecture existante.

---

### US-A6.2 — Panneau de validation fiable, quel que soit le terminal
**Segments :** tous secteurs, en particulier ceux à forte mobilité (livraison,
intervention à domicile, vente ambulante).
**En tant qu'** utilisateur, **je veux** que le panneau de validation des actions
proposées par l'assistant fonctionne de façon fiable sur mobile comme sur ordinateur,
**afin de** garder le contrôle humain sur les écritures agentiques quel que soit
l'appareil utilisé au moment où j'en ai besoin.

**Contexte :** cette story reprend directement le défaut confirmé lors de la recette du
14 août (panneau "Actions à valider" visuellement vide malgré des données backend
correctes) — un bug d'affichage sur ce point précis compromet un pilier de sécurité du
produit pour tous les secteurs, pas seulement le bâtiment.

**Critères d'acceptation :**
- Étant donné une action en attente de validation, quand l'utilisateur ouvre le
  panneau "Actions à valider", alors elle est visible et actionnable, sur mobile comme
  sur ordinateur.
- Étant donné un clic sur "Approuver", quand il est exécuté, alors le statut de
  l'action en base passe bien de EN_ATTENTE à une décision effective, de façon
  vérifiable.
- Étant donné une réponse en langage naturel ("OK") dans le chat, quand une action est
  déjà en attente, alors elle ne crée jamais une seconde action identique en doublon
  silencieux.

**Points d'attention :** cette story est un correctif, pas une évolution — elle doit
être traitée en priorité indépendamment du travail de généralisation sectorielle, car
elle affecte déjà l'usage bâtiment actuel.

**Priorité :** Must — pilier de sécurité produit cassé en pratique, indépendamment du
secteur.

---

### US-A6.3 — Refus explicite d'une demande hors périmètre
**Segments :** tous secteurs, en particulier ceux à forte sensibilité réglementaire
(santé, professions réglementées).
**En tant qu'** utilisateur, **je veux** que l'assistant refuse explicitement et
explique pourquoi lorsqu'on lui demande d'agir hors de son périmètre autorisé
(calculer lui-même un prix, donner un avis médical, engager juridiquement
l'entreprise), **afin de** comprendre les limites du système plutôt que de recevoir une
réponse silencieusement fausse ou dangereuse.

**Contexte :** dans un secteur réglementé (santé, droit), une réponse imprécise de
l'assistant a des conséquences plus graves qu'un devis mal chiffré dans le bâtiment —
la clarté du refus devient un enjeu de sécurité, pas seulement de qualité de produit.

**Critères d'acceptation :**
- Étant donné une demande de calcul de prix sans donnée de catalogue disponible, quand
  l'assistant y répond, alors il indique explicitement qu'il ne peut pas chiffrer plutôt
  que de proposer un montant approximatif.
- Étant donné une demande relevant d'un avis professionnel réglementé (médical,
  juridique, fiscal au-delà de la simple gestion), quand elle est posée, alors
  l'assistant refuse et oriente vers un professionnel qualifié.
- Étant donné un refus formulé, quand l'utilisateur le consulte, alors le message
  explique la raison du refus en des termes compréhensibles, pas un message d'erreur
  technique.

**Points d'attention :** cette story doit être co-écrite avec une revue de conformité
sectorielle avant tout déploiement dans un secteur réglementé (santé notamment) — les
limites exactes du refus ne sont pas uniquement un choix produit.

**Priorité :** Must pour tout secteur réglementé déployé ; Should pour le tronc commun
générique.

---

### US-A6.4 — Historique des décisions exploitable en cas de contrôle
**Segments :** tous secteurs, en particulier ceux soumis à des contrôles
réglementaires fréquents (santé, marchés publics, professions réglementées).
**En tant qu'** OWNER, **je veux** un historique consultable et exportable de toutes
les actions proposées par l'assistant et de leur décision humaine, **afin de** disposer
d'une preuve en cas de contrôle réglementaire ou de litige avec un client.

**Contexte :** cette traçabilité est déjà identifiée comme nécessaire pour le bâtiment
— elle devient un besoin de conformité renforcé dans des secteurs à contrôle fréquent
(URSSAF, ordres professionnels, marchés publics).

**Critères d'acceptation :**
- Étant donné une action décidée (approuvée, rejetée, expirée), quand elle apparaît
  dans l'historique, alors la date, l'auteur de la décision et le contenu exact de
  l'action proposée sont conservés de façon immuable.
- Étant donné une demande d'export de cet historique, quand elle est effectuée, alors
  le format produit est exploitable par un tiers (auditeur, contrôleur) sans dépendre de
  l'interface NODAQ.
- Étant donné une action expirée sans décision, quand elle apparaît dans l'historique,
  alors ce statut est distinct d'une approbation ou d'un rejet explicite.

**Points d'attention :** l'immuabilité de cet historique doit suivre la même doctrine
que les documents archivés (écriture sans possibilité de modification a posteriori) —
ne pas construire un mécanisme de traçabilité qui serait lui-même modifiable.

**Priorité :** Should — déjà en partie couvert par l'architecture existante
(pending_actions), l'enjeu est l'export et l'exploitabilité externe.

---

### US-A6.5 — Gain de temps affiché après chaque action d'agent validée
**Segments :** tous secteurs.
**En tant qu'** utilisateur, **je veux** voir une estimation concrète du temps que
l'assistant vient de me faire gagner après avoir validé une action (devis généré,
relance envoyée, rapprochement effectué), **afin de** percevoir la valeur réelle de
l'outil au fil de l'usage, pas seulement en théorie au moment de l'achat.

**Contexte :** une analyse du positionnement marketing de Dust (dust.tt) montre que
leurs cas d'usage ne sont jamais présentés comme des listes de fonctionnalités mais
comme du temps rendu chiffré ("2h/jour de recherche économisées", "2 jours devenus
quelques heures"). Pour NODAQ, cette logique est plus forte si elle est vécue dans le
produit lui-même au moment de l'usage, plutôt que réservée à une page marketing — un
artisan qui voit "3 minutes au lieu de 45" après chaque devis généré retient la valeur de
l'outil sans effort de conviction supplémentaire.

**Critères d'acceptation :**
- Étant donné une action d'agent validée par l'utilisateur (génération de devis,
  relance d'impayé, rapprochement bancaire), quand elle se termine, alors une estimation
  de temps gagné s'affiche, calculée à partir d'une durée de référence pour l'action
  manuelle équivalente.
- Étant donné un cumul d'actions sur une période, quand l'utilisateur consulte un
  résumé (par exemple hebdomadaire), alors le temps total estimé gagné est visible en un
  coup d'œil.
- Étant donné une estimation affichée, quand elle est calculée, alors sa méthode reste
  cohérente et vérifiable (pas un chiffre arbitraire ou gonflé) — la durée de référence
  manuelle doit être documentée et ajustable si elle s'avère irréaliste pour un secteur
  donné.

**Points d'attention :** rester rigoureux sur la méthode de calcul du temps de référence
manuel — une estimation exagérée qui se révèle fausse à l'usage nuirait à la confiance
plus qu'elle ne l'aiderait. Ne pas transformer cet indicateur en distraction qui
détournerait l'attention du panneau de validation lui-même (US-A6.2).

**Priorité :** Should — améliore la perception de valeur au fil de l'usage, non bloquant
pour le fonctionnement du produit.
