# Epic A2 — Devis / proposition commerciale & facturation

> Extrait du **backlog produit v3** (transmis le 16/08/2026), éclaté par
> epic et par module le 23/08/2026. Le texte est repris **sans modification**.
> # PARTIE A — TRONC COMMUN (toute TPE/PME)

### US-A2.1 — Vocabulaire commercial adapté au secteur
**Segments :** tous secteurs — le mot "devis" ne convient pas à tous les usages
(honoraires pour un conseil, note pour un restaurant, proposition pour un service).
**En tant qu'** utilisateur, **je veux** que le document envoyé à mon client porte le
nom d'usage de mon secteur (devis, proposition commerciale, note d'honoraires) **afin
que** mon client reconnaisse immédiatement un document conforme aux usages de ma
profession.

**Contexte :** le fond du document (lignes, prix, TVA, validité) est identique quel que
soit le secteur ; seuls le nom et certaines mentions changent. C'est un cas typique où
généraliser le moteur et paramétrer l'habillage évite de dupliquer la logique métier.

**Critères d'acceptation :**
- Étant donné un profil "profession libérale", quand un document commercial est généré,
  alors son en-tête affiche "Note d'honoraires" ou "Proposition" plutôt que "Devis".
- Étant donné un profil "bâtiment", quand le même document est généré, alors l'en-tête
  reste "Devis", sans changement de comportement pour les utilisateurs existants.
- Étant donné n'importe quel secteur, quand le document est calculé, alors la même
  logique de calcul de TVA, remise et total s'applique — seul l'habillage change.

**Points d'attention :** ne pas dupliquer le moteur de calcul par secteur ; un seul
moteur, un habillage piloté par une table de correspondance secteur → vocabulaire.

**Priorité :** Must — condition de crédibilité immédiate pour tout secteur hors
bâtiment.

---

### US-A2.2 — Dictée vocale utile hors chantier
**Segments :** tous secteurs où les mains sont occupées ou la saisie au clavier est peu
pratique (cuisine, salon de coiffure en plein rendez-vous, intervention à domicile).
**En tant qu'** utilisateur qui ne peut pas s'arrêter pour taper (en cuisine, en plein
rendez-vous client, en intervention à domicile), **je veux** dicter une proposition
commerciale ou une note comme sur un chantier, **afin de** capter l'information dans
l'instant plutôt que de la reconstituer de mémoire plus tard.

**Contexte :** la dictée vocale existe déjà et fonctionne bien pour le bâtiment ; rien
dans son fonctionnement ne devrait la limiter à ce secteur — c'est une fonction
d'accessibilité et de productivité universelle.

**Critères d'acceptation :**
- Étant donné un profil "restauration" ou "services à la personne", quand
  l'utilisateur dicte une prestation, alors les lignes sont extraites avec quantités et
  libellés cohérents, comme pour le bâtiment.
- Étant donné un catalogue vide pour ce secteur, quand la dictée aboutit, alors les
  lignes sans prix connu sont marquées "à compléter", jamais un prix inventé.
- Étant donné un terme métier propre au secteur (ex. "shampoing", "prestation de
  ménage", "consultation"), quand il est dicté, alors il est reconnu sans nécessiter un
  vocabulaire BTP.

**Points d'attention :** vérifier que le modèle de langage n'a pas été implicitement
biaisé (prompt, exemples few-shot) vers un vocabulaire de chantier lors de son
paramétrage initial.

**Priorité :** Should — différenciant fort, mais la facturation classique doit
fonctionner avant que la dictée soit une priorité sectorielle.

---

### US-A2.3 — Facturation récurrente générique
**Segments :** tout secteur avec des clients sous contrat périodique (chauffagiste,
mais aussi salle de sport, service de ménage récurrent, abonnement de maintenance
informatique).
**En tant qu'** entreprise avec des clients sous contrat périodique, **je veux**
programmer une facturation récurrente automatique, **afin de** ne pas avoir à émettre
manuellement chaque échéance pour chacun de mes clients abonnés.

**Contexte :** la récurrence contractuelle n'est pas propre au chauffagiste avec
contrat d'entretien — c'est un besoin transversal (salle de sport, femme de ménage,
maintenance informatique, abonnement de service).

**Critères d'acceptation :**
- Étant donné un contrat marqué récurrent avec une périodicité définie, quand
  l'échéance arrive, alors une facture est générée automatiquement selon les mêmes
  lignes que le contrat d'origine.
- Étant donné une génération automatique, quand elle a lieu, alors elle suit la même
  chaîne de validation humaine que toute écriture agentique (pas d'envoi automatique
  sans confirmation si le contrat ne l'a pas explicitement autorisé).
- Étant donné un client qui résilie en cours de période, quand la résiliation est
  enregistrée, alors la prochaine échéance automatique est annulée sans intervention
  manuelle supplémentaire.

**Points d'attention :** la frontière entre "génération automatique du document" et
"envoi automatique au client" doit rester distincte — générer n'est pas envoyer, et
l'envoi reste une action à valider comme toute écriture agentique.

**Priorité :** Should — fort payback pour les modèles d'affaires par abonnement, quel
que soit le secteur.

---

### US-A2.4 — Facturation au temps passé
**Segments :** professions libérales et conseil, mais aussi artisanat de service
facturé à l'heure.
**En tant que** professionnel qui facture au temps passé plutôt qu'au forfait, **je
veux** pouvoir constituer une facture à partir d'un nombre d'heures et d'un taux
horaire, avec le détail des dates d'intervention, **afin de** justifier mon montant
facturé sans reconstruire un tableau à part.

**Contexte :** le bâtiment facture presque toujours au forfait ou au métré ; une part
importante des TPE/PME françaises (conseil, réparation, certains artisans de service)
facture au temps passé, avec une exigence de traçabilité différente.

**Critères d'acceptation :**
- Étant donné une prestation facturée au temps, quand l'utilisateur saisit ou importe
  des heures, alors la facture calcule automatiquement le montant à partir du taux
  horaire renseigné dans le profil ou le contrat.
- Étant donné une facture au temps passé, quand elle est générée, alors le détail des
  dates et durées est disponible en pièce jointe ou en annexe du document, pas seulement
  le total.
- Étant donné un taux horaire modifié en cours d'année, quand une nouvelle facture est
  émise, alors elle applique le taux en vigueur à la date de la prestation, pas le taux
  courant.

**Points d'attention :** ce mode de facturation croise directement le pointage
d'heures déjà existant (Epic A4) — éviter de construire deux systèmes de saisie
d'heures parallèles pour un même besoin.

**Priorité :** Should — spécifique à un sous-ensemble de secteurs mais structurant pour
eux (conseil notamment).

---

### US-A2.5 — TVA multi-taux générique
**Segments :** tous secteurs avec des taux de TVA multiples sur une même facture
(restauration : 10 % sur place / 5,5 % à emporter certains produits ; commerce :
20 % standard et 5,5 % sur certains produits alimentaires).
**En tant qu'** utilisateur, **je veux** appliquer des taux de TVA différents par ligne
de document selon la nature du produit ou de la prestation, **afin de** rester conforme
sans avoir à calculer manuellement chaque taux.

**Contexte :** le bâtiment a déjà trois taux de TVA à gérer (20 %, 10 %, 5,5 %) — le
moteur existe déjà et doit simplement être vérifié comme non couplé implicitement à des
règles bâtiment (autoliquidation, attestation travaux).

**Critères d'acceptation :**
- Étant donné une ligne de document, quand un taux de TVA est choisi parmi les taux
  légaux en vigueur, alors le calcul de la ligne et du total s'ajuste correctement sans
  dépendre d'une logique bâtiment.
- Étant donné une facture avec plusieurs taux, quand elle est finalisée, alors le
  récapitulatif de TVA par taux (base et montant) apparaît distinctement, condition
  légale de toute facture française.
- Étant donné un secteur sans règle d'autoliquidation ou d'attestation travaux, quand
  une facture est émise, alors ces mécanismes spécifiques au bâtiment ne s'affichent
  pas et ne bloquent rien.

**Points d'attention :** vérifier explicitement, par un test dédié, que le moteur de
TVA multi-taux ne dépend d'aucune donnée bâtiment-spécifique (attestation, code NAF
travaux) pour fonctionner sur un autre secteur.

**Priorité :** Must — une erreur de TVA est un risque de conformité immédiat, pas une
simple question d'ergonomie.

---

### US-A2.6 — Conformité à la facturation électronique obligatoire
**Segments :** tous secteurs, tous tenants — c'est une obligation légale transversale,
pas une fonctionnalité optionnelle.
**En tant qu'** entreprise assujettie à la TVA, **je veux** que NODAQ reçoive et, à
terme, émette mes factures au format électronique réglementaire via une plateforme
agréée, **afin de** rester en conformité avec la réforme de facturation électronique et
de ne pas m'exposer à une sanction ni à une rupture de mon activité de facturation.

**Contexte :** calendrier confirmé (décret n° 2026-677 et arrêté du 27 juillet 2026,
JO du 28/07/2026, recoupé avec economie.gouv.fr) : réception obligatoire pour **toutes**
les entreprises assujetties dès le **1er septembre 2026** (dans quelques semaines au
moment de la rédaction de cette v3) ; émission (+ e-reporting) obligatoire pour les
grandes entreprises/ETI à la même date, puis étendue à **toutes les PME et
micro-entreprises/TPE au 1er septembre 2027**. Le PPF n'échange plus les factures
lui-même (rôle réduit à annuaire + routage) : l'échange réel passe obligatoirement par
une **plateforme agréée (PA)** tierce, avec laquelle NODAQ doit s'interfacer. Le format
Factur-X reste la référence — cohérent avec l'infrastructure déjà existante
(`lib/facturx`), ce qui limite le travail à l'intégration du flux d'échange plutôt qu'à
la reconstruction du format.

**Critères d'acceptation :**
- Étant donné une facture fournisseur reçue au format électronique réglementaire (via la
  plateforme agréée choisie par NODAQ), quand elle arrive, alors elle est capturée et
  rattachée au bon tenant sans ressaisie manuelle, avant le 1er septembre 2026.
- Étant donné une facture émise par un tenant NODAQ après le 1er septembre 2027, quand
  elle est finalisée, alors elle est transmise au format électronique réglementaire via
  la plateforme agréée et les données de e-reporting associées sont envoyées si le tenant
  est concerné par cette obligation à cette date.
- Étant donné une facture non conforme au format requis après l'entrée en vigueur de
  l'obligation d'émission pour le tenant concerné, quand l'émission est tentée, alors
  elle est bloquée avec un message explicite, sur le même modèle que le blocage SIRET
  déjà existant (`auditMentionsFR`).
- Étant donné un changement de plateforme agréée ou d'exigence technique en cours de
  route (le pilote national a démarré le 27/02/2026, le dispositif est encore jeune),
  quand ce changement survient, alors il est absorbé par une couche d'intégration isolée,
  sans réécriture du moteur de facturation métier.

**Points d'attention :** ne pas construire d'échange direct avec le PPF — son rôle est
désormais limité à l'annuaire et au routage, pas à l'échange de factures. Le choix et le
contrat avec une plateforme agréée est un sujet business/juridique à traiter en parallèle
du développement technique, pas seulement une intégration API. Une tolérance
administrative est annoncée pour la phase de démarrage, mais elle ne dispense pas de
préparer l'échéance du 1er septembre 2026 qui concerne 100% des tenants côté réception.

**Priorité :** Must — prérequis de survie commerciale pour un logiciel de facturation
français à cette date, indépendamment de tout secteur ; à traiter en urgence absolue vu
l'échéance de réception au 1er septembre 2026.
