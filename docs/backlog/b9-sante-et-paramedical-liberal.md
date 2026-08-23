# Module B9 — Santé & paramédical libéral

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE B — MODULES SECTORIELS

### US-B9.1 — Facturation patient hors circuit de tiers payant
**En tant que** praticien paramédical libéral (kinésithérapeute, ostéopathe non
conventionné), **je veux** facturer directement mon patient pour les prestations hors
prise en charge par un tiers payant, **afin de** gérer la part de mon activité qui
échappe au circuit de télétransmission classique, sans dépendre d'un logiciel métier de
santé pour cette seule fonction.
**Critères d'acceptation :** étant donné une prestation hors tiers payant, alors une
facture ou note standard peut être émise au patient selon le même moteur que le tronc
commun ; étant donné le périmètre du tiers payant lui-même (télétransmission CPAM),
alors il reste explicitement hors périmètre de NODAQ, sans tentative de le simuler
partiellement de façon trompeuse.
**Priorité :** Should — valeur réelle sur la partie non couverte par les logiciels
métier de santé existants, sans chercher à concurrencer leur cœur de métier réglementé.

### US-B9.2 — Confidentialité des données de santé
**En tant que** praticien de santé, **je veux** une garantie explicite que les données
de santé de mes patients, même limitées à des informations administratives
(nom, créneaux de rendez-vous), bénéficient du niveau de protection le plus élevé prévu
par l'application, **afin de** respecter mes obligations de secret médical.
**Critères d'acceptation :** identique à US-A7.2 (confidentialité renforcée secret
professionnel), avec revue spécifique documentée pour ce module avant tout déploiement.
**Priorité :** Must avant tout déploiement en secteur de santé — condition préalable,
pas une amélioration ultérieure.

### US-B9.3 — Rappel de rendez-vous patient
**En tant que** praticien de santé, **je veux** envoyer un rappel de rendez-vous à mes
patients, **afin de** réduire les rendez-vous manqués qui ont un coût direct significatif
dans une activité à créneaux individuels.
**Critères d'acceptation :** identique à US-B6.2 (rappel de rendez-vous), avec un
formalisme de communication adapté au contexte de santé (éviter toute information
médicale dans le rappel lui-même, qui doit rester strictement logistique).
**Priorité :** Should — impact économique direct, à formuler avec prudence sur le
contenu du message envoyé.

### US-B9.4 — Séparation stricte administratif / dossier médical, avec contrainte technique dure sur les champs sensibles
**En tant que** praticien de santé, **je veux** que l'application reste strictement
cantonnée à la gestion administrative (facturation, planning, trésorerie) sans jamais
prétendre gérer un dossier médical, et que cette limite soit imposée par la structure
même des champs disponibles plutôt que par un simple principe d'usage, **afin de** ne
pas créer de confusion sur le périmètre de l'outil ni de risque réglementaire lié à
l'hébergement de données de santé au sens strict (HDS).
**Critères d'acceptation :** étant donné l'usage de l'application par un praticien de
santé, alors aucune fonctionnalité ne permet la saisie d'un contenu médical structuré
(diagnostic, prescription) ; étant donné le champ "motif" d'un rendez-vous, alors il est
restreint à une liste fermée de libellés neutres non médicaux (validés par un avis
juridique dédié), sans champ de texte libre non contraint ; étant donné toute autre
zone liée au patient (notes, pièces jointes), alors aucune n'accepte de contenu libre non
structuré qui permettrait l'entrée de données cliniques par la bande ; étant donné une
tentative d'usage en ce sens, alors l'interface oriente explicitement vers un outil
métier de santé dédié et certifié HDS.
**Point d'attention :** la frontière HDS/non-HDS n'est tranchée noir sur blanc par aucun
texte officiel identifié à ce jour (art. L.1111-8 CSP et référentiel HDS v2, échéance de
mise en conformité au 16/05/2026, définissent le périmètre par la nature
prévention/diagnostic/soins des données, sans liste explicite d'exclusion administrative)
— la lecture "hors HDS" retenue ici est une position défendable mais non certaine
juridiquement ; à faire trancher formellement par un avocat spécialisé santé/CNIL avant
tout déploiement réel en secteur de santé, en particulier sur le champ "motif de
rendez-vous" qui est le point de bascule le plus sensible.
**Priorité :** Must — c'est une limite de périmètre volontaire, pas un oubli à combler ;
son absence de respect exposerait à des obligations d'hébergement de données de santé
(certification HDS) hors du périmètre actuel de l'infrastructure.

---

## Priorisation suggérée pour la suite

Compte tenu de ce qui existe déjà (module bâtiment mature) et de ce qui structure
l'ouverture aux autres secteurs, l'ordre logique n'est pas de construire les modules
sectoriels un par un, mais de traiter d'abord le tronc commun :

0. **US-A2.6** (conformité facturation électronique) passe devant tout le reste dans
   cette v3 : l'obligation de réception s'applique à 100% des tenants dès le 1er
   septembre 2026, une échéance légale fixe qui ne se négocie pas avec une feuille de
   route produit — ce n'est plus une question de priorisation mais de délai disponible.
1. **US-A1.1** (onboarding sans présomption de secteur) et **US-A4.1** (pointage sans
   "chantier") sont les deux blocages les plus immédiats derrière l'échéance légale —
   sans eux, aucun autre secteur n'est réellement utilisable, quel que soit le module
   construit ensuite.
2. **US-A6.2** (panneau de validation fiable) reste un correctif à traiter indépendamment
   de toute logique sectorielle — c'est un défaut déjà confirmé en recette sur le
   bâtiment.
3. **US-A2.1** (vocabulaire commercial adapté) et **US-A2.5** (TVA multi-taux générique)
   conditionnent la crédibilité immédiate de tout module sectoriel ultérieur.
4. **US-A3.5** (prévisionnel de trésorerie) est le différenciateur commercial le plus
   directement actionnable identifié face aux concurrents directs déjà installés
   (Tiime, Axonaut, Henrri, Indy) — à traiter tôt car c'est un argument de vente, pas
   seulement une fonctionnalité de confort.
5. Le choix du premier module sectoriel à construire après le bâtiment devrait suivre un
   critère commercial (taille du marché adressable, cycle de vente) plutôt que
   technique — cette décision dépasse le cadre de ce backlog produit.

## Notes de veille concurrentielle à garder en tête (issues de l'analyse Dust)

Ces points ne sont pas des user stories mais des garde-fous business à ne pas perdre en
cours de développement :

- **Tarification simple et prévisible.** Ne jamais copier un modèle hybride
  sièges + crédits, même si des concurrents plus gros y vont — la simplicité de
  facturation est un argument de vente pour une TPE, pas un détail d'implémentation.
- **Valeur perçue dès l'inscription, pas après un projet d'intégration de plusieurs
  semaines.** Un déploiement en plusieurs phases avec accompagnement dédié fonctionne
  pour une PME/ETI avec un budget de transformation ; une TPE de 5 personnes abandonne
  avant la fin d'un tel parcours.
- **Ne pas présupposer un existant technique riche** (CRM, Slack, outils déjà en place)
  comme condition de valeur — NODAQ doit fonctionner comme le stack de gestion lui-même
  pour une entreprise qui n'en a pas, pas comme une couche au-dessus d'un stack existant.
- **Suivre l'usage hebdomadaire par tenant (WAU/MAU) comme métrique de santé produit**,
  indépendamment de tout usage marketing — signal de rétention plus fiable qu'un chiffre
  d'acquisition brut.
