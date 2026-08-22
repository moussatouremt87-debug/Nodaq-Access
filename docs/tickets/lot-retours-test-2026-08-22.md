<!-- Versionné le 22/08/2026. Numérotation décalée de +1 : le 4.22 était déjà
     pris par `ticket-4.22-flottement-suite.md`, ouvert le même jour. -->

# Retours de test écrans — lot de tickets 4.23 → 4.30

> Rédigé en tant que product owner à partir de la session de test du 22 août 2026.
> Chaque ticket est autonome et peut être donné tel quel à Claude Code.
> Ordre de traitement recommandé : P0 dans l'ordre, puis P1, puis P2.

---

## Trois règles produit qui découlent de ce test

Elles s'appliquent à tout le produit, pas seulement aux tickets ci-dessous.
À ajouter dans `CLAUDE.md`.

1. **L'agent ne dit jamais « je ne peux pas » pour une action que nodaq sait faire.**
   S'il lui manque un outil, c'est un bug d'outillage, pas une réponse acceptable.
   Et il ne renvoie **jamais** vers un logiciel tiers ou un expert-comptable pour une
   fonction du produit.
2. **Aucun mot de jargon anglo-saxon ou financier dans l'interface.** L'utilisateur
   est un artisan, pas un analyste. MRR, YTD, churn, pipeline value : bannis.
3. **Toute action qui change un état financier est annulable**, et le dit au moment
   où elle est faite.

---

# P0 — bloquants

## Ticket 4.23 — L'agent refuse de faire son métier

**Verbatim du test** (répété sur 4 écrans) : « Le chat agent a été conçu pour ce
genre de tâches, pourquoi répond-il cela ? »

**Symptôme constaté.** À la question « tu sais faire des factures au format officiel
du 1er septembre 2026 ? », l'agent répond :
« Non, je ne peux pas créer de factures. […] Tu peux utiliser un logiciel de
comptabilité ou faire appel à un expert-comptable pour créer des factures conformes
à la réglementation en vigueur. »

**Gravité.** Maximale. Ce n'est pas un bug d'ergonomie : le produit vend contre
lui-même, recommande la concurrence, et détruit la promesse commerciale de la
landing page dans la première minute d'usage.

**Cause probable.** L'agent de chat n'a aucun outil branché (les serveurs MCP
`actions` / `connectors` ne sont pas exposés à cette session), et/ou le prompt
système contient des garde-fous de refus trop larges hérités d'un modèle générique.

**À faire.**
- Brancher sur l'agent de chat l'intégralité des outils métier existants : création
  et modification de devis, factures, avoirs, contrats, chantiers, prospects, saisie
  d'heures, consultation du cockpit.
- Réécrire le prompt système : l'agent est **l'opérateur du produit**, pas un
  assistant généraliste. Il agit via ses outils et, pour toute écriture, crée une
  `pending_action` à valider (règle 4) au lieu de refuser.
- Interdire explicitement dans le prompt : dire qu'il ne sait pas faire une
  fonctionnalité existante, renvoyer vers un logiciel tiers, renvoyer vers un
  expert-comptable pour une tâche produit.
- Quand une capacité n'existe vraiment pas encore, la réponse type devient :
  « Ce n'est pas encore disponible dans nodaq, je le note pour l'équipe » — jamais
  « utilise autre chose ».
- Corriger aussi la réponse « Je n'ai pas d'activité à te résumer pour aujourd'hui »
  alors que le tenant a des chantiers, devis et factures : l'agent doit lire les
  données du tenant via `withTenant`.

**Critères d'acceptation.**
- « Fais-moi une facture pour le chantier X » aboutit à une `pending_action` de
  création de facture, visible dans le cockpit.
- « Résume mon activité » renvoie des données réelles du tenant.
- Une éval automatisée vérifie que l'agent ne prononce jamais les formules de refus
  interdites sur les 20 tâches produit principales.

---

## Ticket 4.24 — La commande vocale ne fonctionne pas

**Verbatim.** « La commande vocale ne marche pas. »

**À faire.** Diagnostiquer la chaîne complète : permission micro navigateur, capture,
envoi au service de transcription, retour dans le fil de conversation, gestion des
erreurs. Afficher un état visible (écoute en cours / transcription / erreur) plutôt
qu'un échec silencieux. Tester sur Safari iOS et Chrome Android, qui sont les
navigateurs réels des utilisateurs.

**Décision produit associée.** L'écran **« Devis dicté » est supprimé** : la fonction
vocale est portée par l'agent unique, qui comprend l'intention quel que soit le
sujet. Retirer l'entrée du menu, rediriger l'ancienne route vers le chat, et
supprimer le code mort.

---

## Ticket 4.25 — Aucun document PDF téléchargeable

**Verbatim.** « Quand je génère un devis, une facture ou un contrat, je devrais avoir
un document PDF téléchargeable. »

**À faire.** Génération PDF serveur pour devis, facture, avoir et contrat, avec les
mentions légales obligatoires, le logo et les coordonnées du tenant. Bouton
« Télécharger le PDF » sur chaque fiche, et pièce jointe dans les envois. Le PDF est
la pièce que l'artisan imprime, envoie et archive : sans lui, le produit n'est pas
utilisable en clientèle.

**À prévoir dès maintenant** : le format doit être compatible **Factur-X** (PDF/A-3
avec facture XML embarquée) pour la réforme de la facturation électronique. Structurer
le générateur pour que l'ajout du XML soit une évolution, pas une réécriture.

---

## Ticket 4.26 — Action irréversible : « marquer comme payée »

**Verbatim.** « J'ai cliqué sur "marquer comme payée" par accident mais je n'ai pas
de moyen de revenir en arrière. »

**À faire.**
- Rendre l'action réversible : « Annuler le paiement » sur la fiche facture, qui
  restaure l'état précédent et journalise l'opération.
- Afficher un bandeau d'annulation immédiate pendant quelques secondes après le clic
  (« Facture marquée payée — Annuler »).
- Appliquer le même traitement à toutes les actions qui changent un état financier
  ou envoient quelque chose : archivage, validation, envoi, clôture de chantier.
- Journaliser dans le journal des décisions : qui, quand, quoi, valeur avant/après.

---

## Ticket 4.27 — L'invitation du comptable n'arrive jamais

**Verbatim.** « Quand j'invite un comptable, je check la boîte mail, aucune
invitation n'apparaît même dans les spams. On doit résoudre ce problème. »

**Gravité.** Le rôle `ACCOUNTANT` est un canal d'acquisition (prescription par les
cabinets) autant qu'une fonctionnalité. S'il ne marche pas, la stratégie
expert-comptable ne peut pas démarrer.

**À faire.** Diagnostiquer l'envoi transactionnel de bout en bout : file d'envoi,
fournisseur configuré, domaine d'expédition, journalisation des échecs. Ajouter un
écran d'état des invitations (envoyée / ouverte / acceptée / échouée) avec bouton
« Renvoyer », et un lien d'invitation copiable en secours. Vérifier que le domaine
expéditeur est bien authentifié (SPF, DKIM, DMARC configurés le 21/08).

---

# P1 — friction quotidienne

## Ticket 4.28 — Champs numériques inutilisables

**Verbatim.** « Quand je veux saisir le P.U HT, je dois manuellement effacer tous les
0 pour ensuite saisir le montant, c'est chiant pour les users. »

**À faire.** Créer un composant de saisie monétaire unique et l'utiliser partout :
champ vide par défaut (placeholder `0,00 €`, pas valeur `0`), sélection totale au
focus, séparateur décimal virgule ET point acceptés, formatage à la sortie du champ,
clavier numérique sur mobile. Passer en revue **tous** les champs de montants et de
quantités du produit — devis, factures, charges, heures.

---

## Ticket 4.29 — Vocabulaire incompréhensible pour un artisan

**Verbatim.** « Un artisan ne comprend pas le mot MRR. » — « "YTD" n'est pas
compréhensible pour un artisan. » — « "voir les 1 devis" (ce n'est pas correct en
français). »

**À faire.**
- Remplacer **MRR** par « Revenus récurrents mensuels » ou « Abonnements par mois »
  selon le contexte ; **YTD** par « Depuis le 1er janvier ».
- Passer en revue tous les libellés de l'application et éliminer le jargon.
- Corriger les pluriels : utiliser une fonction de pluralisation
  (`1 devis` / `2 devis`, `1 facture` / `2 factures`) et supprimer les libellés
  construits par concaténation.
- Créer `packages/shared/glossary.ts` : un dictionnaire des termes autorisés, avec
  les interdits en commentaire. Toute nouvelle étiquette passe par là.

---

## Ticket 4.30 — Navigation : liens qui mènent au mauvais écran

**Verbatim.** « Quand je clique sur "voir les 1 devis" […] ça me mène dans la page
chantier au lieu de devis. »

**À faire.** Corriger le lien, puis auditer tous les liens « voir les N … » du
cockpit et des fiches : chacun doit mener à la liste filtrée correspondante
(devis du chantier, factures du client, heures de la semaine…). Ajouter un test
end-to-end qui suit chaque lien de compteur.

---

## Ticket 4.31 — Cohérence chantiers / heures / classeur

**Verbatims.** « Quand je crée un chantier en cours, pourquoi il n'apparaît pas dans
les heures de la semaine ? » — « J'avais ajouté une facture au tout début mais elle
n'apparaît pas dans le classeur. » — « Date de début doit correspondre à quoi ?
(date de début du chantier ? date de saisie du chantier ?) »

**À faire.**
- Un chantier au statut « en cours » doit apparaître automatiquement comme
  affectation sélectionnable dans la saisie des heures de la semaine courante.
- Tout document créé ou importé (facture, devis, contrat, photo) doit apparaître dans
  le Classeur : vérifier l'indexation, et ajouter un test qui crée une facture et
  vérifie sa présence dans le classeur.
- Renommer « Date de début » en **« Date de début des travaux »**, avec une mention
  d'aide « laisser vide si la date n'est pas encore fixée ». La date de saisie est
  une métadonnée système, elle n'est jamais demandée à l'utilisateur.
- Sur le formulaire prospect : le champ **« Société » devient facultatif** et son
  libellé passe à « Société (si professionnel) ». Ajouter un choix
  « Particulier / Professionnel » qui adapte les champs et les mentions du devis.

---

# P2 — à cadrer

## Ticket 4.32 — Écran d'intégrations trop complexe

**Verbatim.** « Beaucoup trop compliqué pour des artisans d'intégrer leurs outils de
cette manière. » — « Pourquoi ces messages d'erreur ? Il faut connecter quoi ? »

**À faire.** Refondre l'écran en logique de bénéfice, pas de technique : chaque carte
dit ce que ça apporte (« Recevoir vos factures fournisseurs automatiquement »), un
seul bouton « Connecter », et un état lisible. Aucune erreur affichée tant que
l'utilisateur n'a rien tenté : une intégration non connectée est un état normal, pas
une erreur. Réécrire tous les messages d'erreur pour qu'ils disent quoi faire, pas ce
qui a échoué.

## Ticket 4.33 — Relance multicanal sur les étapes commerciales

**Verbatim.** « Si je choisis les statuts prospect, devis envoyé, devis accepté, on
doit prévoir une relance du client par email et WhatsApp. »

**À faire.** Étendre le moteur de relance existant aux étapes commerciales, et pas
seulement aux factures impayées : relance automatique paramétrable après X jours sans
réponse sur un devis envoyé, par e-mail et par WhatsApp (lien `wa.me` prérempli).
Chaque relance passe par une `pending_action` (règle 4). **Dépend du ticket 4.21**
(lien de paiement et envoi WhatsApp) : à traiter après.

---

# Corrections apportées aux prémisses (22/08/2026, après vérification du code)

Trois affirmations du lot se sont révélées inexactes à la lecture du code. Elles
sont consignées ici plutôt que corrigées en silence : le diagnostic d'origine
reste utile, et savoir *pourquoi* il portait à faux évite de refaire l'erreur.

## Ticket 4.23 — la cause n'était pas l'absence d'outils

Le ticket suppose que « l'agent de chat n'a aucun outil branché ». Il en avait
**quatorze, dont neuf d'écriture**, qui créaient déjà des `pending_action`
conformément à la règle 4. Le mécanisme fonctionnait.

La cause réelle était le **refus n° 2 du prompt système** :

> « UN AVIS PROFESSIONNEL RÉGLEMENTÉ. Médical, juridique, ou *fiscal* au-delà de
> la simple gestion courante. Tu n'es ni médecin, ni avocat, ni
> *expert-comptable*. Oriente vers un professionnel qualifié. »

Le testeur a demandé une facture « au format officiel ». Le modèle a rangé la
question dans « fiscal réglementé » et a fait exactement ce qu'on lui ordonnait.
**Ce n'est pas un modèle qui dérape, c'est une consigne trop large.** Un
garde-fou rédigé pour un assistant généraliste, appliqué à l'opérateur d'un
produit, finit par interdire le produit.

Le manque d'outils était réel, mais plus étroit : rien pour les devis, les
factures, les avoirs, les contrats ni les heures.

## Ticket 4.25 — les PDF existent déjà, Factur-X aussi

Le ticket demande de « prévoir dès maintenant » la compatibilité Factur-X. Elle
est **déjà implémentée** : `lib/facturx`, `archiveFacturxPdf`, et la route
`/facturation-electronique/documents/:id/pdf`.

Existent également : `GET /api/devis/:id/pdf`, le PDF des avoirs, le PDF archivé
des factures servi avec son SHA-256, le PDF du compte de résultat.

Le manque réel est bien plus petit : **les contrats n'ont pas de PDF**, et
certains écrans n'ont pas de bouton de téléchargement. Le ticket passe de P0
(refonte) à P1 (une demi-journée).

## Un bug trouvé en lisant le code

`buildSystemPrompt` calculait sa fenêtre d'échéances avec
`30 * 24 * 60_000` — soit **12 heures**, pas 30 jours ; il manquait un facteur
60. L'agent ne voyait donc presque aucune échéance à venir, ce qui alimentait
directement le « je n'ai pas d'activité à te résumer » signalé par le testeur.
Corrigé.
