# Prompts Replit — tickets 4.8 (profil) et 4.9 (reprise)

> Deux prompts à coller **l'un après l'autre**, dans l'agent Replit, sur la branche
> `replit-rls`. Ne colle le second qu'une fois le premier validé.
> Chaque prompt est découpé en phases : l'agent doit s'arrêter à la fin de chacune.

---

## ⚠️ Avant de coller — les trois pièges propres à ton dépôt

Tu ajoutes des colonnes et une table à un schéma désormais protégé par le RLS. **Trois
listes doivent être mises à jour ensemble**, sinon la protection sera silencieusement
incomplète :

1. `lib/db/scripts/migrate-rls.cjs` → tableau `BUSINESS_TABLES`
2. `artifacts/api-server/src/__tests__/rls.test.ts` → tableau `BUSINESS_TABLE_VARS`
   (la garde structurelle) **et** la boucle du test d'isolation
3. Le schéma Drizzle → la colonne `tenant_id` NOT NULL et l'index composite

C'est écrit dans les prompts ci-dessous, mais vérifie-le toi-même après coup : c'est
exactement le genre d'oubli qui rend le test vert alors qu'une table n'est pas protégée.

Et une règle qui vaut pour les deux prompts : **l'OCR n'existe pas dans ce dépôt.**
L'agent ne doit sous aucun prétexte l'inventer ou simuler une extraction — voir la section
« ne fais pas » de chaque prompt.

---

# PROMPT 1 — Ticket 4.8 : profil d'entreprise

```
Tu vas construire l'onboarding du profil d'entreprise. Le principe directeur, et il prime
sur tout le reste : NE JAMAIS DEMANDER CE QU'ON PEUT ALLER CHERCHER OU CALCULER.
Objectif mesurable : moins de 10 minutes entre la création du compte et le premier devis.

CONTEXTE TECHNIQUE — respecte-le sans exception
- Front : Vite + React + shadcn/ui + Tailwind + wouter + react-query.
- Back : Express 5 + Drizzle + Zod. Base PostgreSQL avec RLS actif.
- TOUT accès à une table métier passe par withTenant(tenantId, tx => ...). Aucune requête
  métier ne doit utiliser `db` directement — une garde automatisée le vérifie.
- Le tenantId vient de la session (resolveTenant), JAMAIS du client.
- Toute entrée externe (formulaire, réponse d'API tierce) est validée par Zod.
- Travaille en 4 phases. Arrête-toi à la fin de chaque phase, montre-moi le résultat et
  attends ma validation.

═══════════════════════════════════════════════
PHASE 1 — Schéma
═══════════════════════════════════════════════

1) Étends la table `settings` (elle porte déjà tenant_id) avec :
   siret, siren, raison_sociale, forme_juridique, adresse, code_postal, commune,
   code_naf, libelle_naf, tranche_effectif, date_creation, tva_intracom, rcs_ville,
   capital, logo_url,
   decennale_assureur, decennale_numero_contrat, decennale_couverture,
   taux_horaire_reel (numeric, nullable),
   conditions_reglement, format_numerotation, iban, plateforme_agreee,
   pack_metier (text).
   Toutes NULLABLES sauf celles déjà existantes. On doit pouvoir entrer dans le produit
   avec le seul SIRET.

2) Étends `team_members` avec :
   type_lien : 'SALARIE' | 'INTERIMAIRE' | 'SOUS_TRAITANT' (défaut 'SALARIE'),
   jours_par_semaine (numeric, défaut 5),
   cout_mensuel_charge (numeric, nullable).

3) Écris un script de migration idempotent dans lib/db/scripts/, sur le modèle exact de
   migrate-multitenant.cjs (vérifier l'existence de la colonne avant de l'ajouter), et
   ajoute-le à la commande db:setup, APRÈS migrate-multitenant et AVANT migrate-rls.

4) Montre-moi le diff du schéma et le résultat de la migration.

═══════════════════════════════════════════════
PHASE 2 — Recherche d'entreprise et calculs
═══════════════════════════════════════════════

5) Crée une route serveur POST /api/entreprises/recherche, protégée par la chaîne
   d'authentification complète (requireAuth, resolveTenant, requireMembership).
   Elle appelle l'API publique française de recherche d'entreprises :
   https://recherche-entreprises.api.gouv.fr/search?q=<terme>
   API ouverte, sans clé d'authentification.

   RÈGLES :
   - L'appel part du SERVEUR, jamais du navigateur.
   - La réponse est validée par un schéma Zod qui ne retient QUE les champs utiles :
     siren, nom_complet, nom_raison_sociale, siege (siret, adresse, code_postal, commune),
     activite_principale, nature_juridique, tranche_effectif_salarie, date_creation,
     etat_administratif. Tout champ inattendu est ignoré, pas propagé.
   - L'API est limitée en débit : gère le code 429 avec un message clair, et mets en
     cache la réponse par terme de recherche pendant 24 h.
   - Si l'API est indisponible, l'utilisateur DOIT pouvoir saisir manuellement. Ne bloque
     jamais l'inscription sur la disponibilité d'un service tiers.

6) Écris deux fonctions utilitaires pures, avec leurs tests unitaires :

   a) validerSiret(siret) : 14 chiffres, contrôle de Luhn.
      ATTENTION : le SIRET de La Poste (SIREN 356000000) ne respecte pas Luhn — prévois
      l'exception, sinon tu rejetteras un SIRET valide.

   b) calculerTvaIntracom(siren) : la clé vaut (12 + 3 * (siren % 97)) % 97, formatée sur
      2 chiffres, puis "FR" + clé + siren.
      Exemple à vérifier dans le test : siren 404833048 → clé 32 → FR32404833048.

7) Écris un mappage code NAF → pack métier, dans un FICHIER DE DONNÉES séparé
   (ex. lib/packs/naf-mapping.ts). Les codes 43.xx et 41.2x donnent le pack bâtiment.
   INTERDIT ABSOLU : aucun `if (pack === 'btp')` ailleurs dans le code. Le pack est une
   donnée, jamais une branche conditionnelle. Un test doit échouer si un nom de verticale
   apparaît dans une condition en dehors de ce fichier.

═══════════════════════════════════════════════
PHASE 3 — Les trois écrans
═══════════════════════════════════════════════

8) ÉCRAN 1 — un seul champ : "Votre SIRET, ou le nom de votre entreprise".
   Après recherche, affiche une fiche pré-remplie à confirmer : un bouton principal
   "Oui, c'est mon entreprise" et un lien discret "Ce n'est pas ça" qui ouvre la saisie
   manuelle. Affiche le numéro de TVA calculé, modifiable.
   Après confirmation, annonce le métier détecté : "Vous êtes <libellé NAF>. J'ai préparé
   ce qu'il faut pour votre métier."

9) ÉCRAN 2 — import de la dernière facture.
   L'OCR N'EXISTE PAS DANS CE DÉPÔT. Tu construis UNIQUEMENT :
   - le téléversement du fichier vers classeur_documents (via withTenant) ;
   - un écran de relecture où chaque champ extrait serait présenté pour validation ;
   - une fonction extraireDepuisDocument() qui lève explicitement une erreur
     "OCR non branché" et un bouton "Je le ferai plus tard" bien visible.
   N'INVENTE PAS d'extraction. Ne simule pas de résultat. Ne renvoie pas de données de
   démonstration. Un écran honnêtement vide vaut mieux qu'une fausse extraction.

10) ÉCRAN 3 — trois questions :
    a) Assurance décennale : assureur, numéro de contrat, couverture géographique.
       C'est une mention légalement obligatoire sur les devis et factures du bâtiment.
    b) L'équipe : prénom, type de lien, jours par semaine, coût mensuel chargé.
       Ajout ligne à ligne, dans un tableau, pas dans un assistant.
    c) Le taux horaire, AVEC un bouton "Je ne sais pas — calculez-le à partir de mes
       chantiers" qui laisse le champ à NULL. Ne mets jamais de valeur par défaut
       inventée : un taux faux contamine toutes les marges ensuite.

11) AUCUN de ces écrans n'est bloquant. On accède au produit avec le seul SIRET.

═══════════════════════════════════════════════
PHASE 4 — Blocages contextuels et tests
═══════════════════════════════════════════════

12) Remplace toute idée de barre de progression par un blocage CONTEXTUEL : un champ
    manquant n'apparaît qu'au moment où son absence empêche une action, et il apparaît
    avec sa conséquence. Exemple exact à reproduire :
    "Il manque votre numéro d'assurance décennale. Sans lui, ce devis n'est pas conforme
     et vous vous exposez à une amende. [Le renseigner — 30 secondes]"

13) Tests à ajouter dans artifacts/api-server/src/__tests__/ :
    a) un compte créé avec le seul SIRET accède au produit et crée une affaire ;
    b) aucune donnée issue de l'API tierce n'est écrite en base sans confirmation
       explicite de l'utilisateur ;
    c) un devis ne peut pas être émis s'il manque une mention légalement obligatoire :
       SIRET, TVA, décennale, conditions de règlement, pénalités de retard, indemnité
       forfaitaire de 40 €. Le test énumère les mentions et échoue si l'une manque ;
    d) test de vocabulaire : échec si "profil complété", "%", "progression" ou
       "complétude" apparaît dans un libellé d'interface ;
    e) tests unitaires de validerSiret et calculerTvaIntracom.

CE QUE TU NE DOIS PAS FAIRE
- Ne simule aucun OCR, aucune extraction, aucune donnée de démonstration.
- Ne rends aucun écran d'onboarding bloquant.
- N'ajoute pas de barre de progression ni de pourcentage de complétion.
- Ne mets aucune valeur par défaut inventée sur le taux horaire.
- N'appelle pas l'API tierce depuis le navigateur.
- N'écris aucun `if` sur un nom de verticale en dehors du fichier de mappage.
```

---

# PROMPT 2 — Ticket 4.9 : reprise de l'existant

*(à coller seulement après validation complète du prompt 1)*

```
Tu vas construire la reprise de l'existant. Principe directeur : ON REPREND UN ÉTAT, PAS
UN HISTORIQUE. Une information n'entre que si elle change une décision de la semaine
prochaine. Personne ne ressaisira neuf mois de factures, et personne n'en a besoin.

Mêmes règles techniques que précédemment : withTenant partout, tenantId depuis la session,
Zod aux frontières, 4 phases avec arrêt et validation à chaque fin de phase.

═══════════════════════════════════════════════
PHASE 1 — Schéma
═══════════════════════════════════════════════

1) `affaires` : montant_vendu_ht, avancement_pct (0-100), date_fin_prevue,
   origine ('REPRISE' | 'CREEE') pour distinguer les données reprises.
2) `factures` : date_emission, montant_ttc, statut ('PAYEE'|'IMPAYEE'|'PARTIELLE'),
   date_echeance.
3) `devis` : date_envoi, statut ('BROUILLON'|'ENVOYE'|'SIGNE'|'REFUSE').
4) `settings` : ca_facture_ytd, ca_encaisse_ytd, date_debut_exercice,
   blocs_reprise_passes (jsonb, liste des blocs explicitement sautés).
   NE STOCKE AUCUN POURCENTAGE D'AVANCEMENT DE L'ONBOARDING. L'état se déduit des données.
5) Script de migration idempotent, ajouté à db:setup au bon endroit. Si tu crées une
   table, mets à jour LES TROIS listes : BUSINESS_TABLES dans migrate-rls.cjs,
   BUSINESS_TABLE_VARS dans rls.test.ts, et la boucle du test d'isolation.

═══════════════════════════════════════════════
PHASE 2 — Les six blocs, dans CET ordre
═══════════════════════════════════════════════

L'ordre est un choix produit, pas un détail : chaque bloc doit rendre quelque chose avant
que le suivant ne demande quoi que ce soit.

① CHANTIERS EN COURS — tableau de saisie rapide, ligne à ligne, 5 colonnes :
  nom, client, montant vendu HT, avancement, date de fin prévue.
  Saisie au clavier de bout en bout, Tab passe à la colonne suivante, Entrée crée une
  ligne. PAS d'assistant pas-à-pas. On ne demande QUE les chantiers ouverts.

② FACTURES IMPAYÉES — 3 colonnes : client, montant TTC, date d'émission.
  Dès la validation, affiche le résultat immédiatement, en euros et en jours, jamais en
  ratios :
  "Sept clients vous doivent 18 400 €. Trois ont plus de 60 jours de retard."
  C'est le bloc au meilleur rendement du produit : ne le déplace pas plus loin.

③ DEVIS EN ATTENTE — 3 colonnes : client, montant, date d'envoi.

④ CHIFFRE D'AFFAIRES DÉJÀ RÉALISÉ — DEUX CHAMPS, PAS UN IMPORT :
  "Depuis le 1er janvier, vous avez facturé combien ?" et "Et encaissé ?" (facultatif).
  N'implémente AUCUNE reprise de factures passées.

⑤ ÉQUIPE — complète l'écran du 4.8 avec les congés déjà posés, enregistrés dans la table
  `absences` existante (elle porte déjà tenant_id et sa policy).

⑥ PLANNING — NE DEMANDE PAS DE TOUT PLANIFIER.
  Déduis une répartition depuis montant + avancement + date de fin de chaque affaire,
  affiche-la, et écris : "Voilà comment je vois vos six prochaines semaines. Corrigez ce
  qui ne va pas." La seule saisie demandée est : qui est sur quoi cette semaine et la
  semaine prochaine.

═══════════════════════════════════════════════
PHASE 3 — Étalement sur sept jours
═══════════════════════════════════════════════

6) JOUR 1, dix minutes : profil (4.8) + les TROIS chantiers les plus importants + les
   factures impayées. Pas tous les chantiers : trois.
7) JOURS 2 à 7 : UNE seule sollicitation par jour, courte, toujours justifiée par ce
   qu'elle débloque. Exemple exact :
   "Il vous reste 5 chantiers à ajouter. Ensuite je pourrai vous dire jusqu'à quand vous
    avez du travail."
   Pas de liste de tâches à cocher. Pas de pourcentage. Une demande, une raison.
8) Chaque bloc a un bouton "Passer" qui l'enregistre dans blocs_reprise_passes et ne le
   redemande plus avant sept jours.

═══════════════════════════════════════════════
PHASE 4 — Garde-fous et tests
═══════════════════════════════════════════════

9) SEUIL DE SILENCE — le plus important de ce ticket.
   Tant que les données sont insuffisantes, l'API renvoie { donneesInsuffisantes: true }
   et AUCUN CHIFFRE. Ni marge, ni taux de jours facturés, ni horizon de charge.
   Jamais un zéro, jamais une moyenne sur deux points : un zéro flatteur est un mensonge.
   Seuils : moins de 3 affaires, ou moins de 2 semaines de données de planning.

10) SOUS-TRAITANT ≠ CAPACITÉ. Une personne dont type_lien = 'SOUS_TRAITANT' entre dans le
    coût mais JAMAIS dans la capacité disponible. Confondre les deux fausse à la fois le
    taux horaire réel et l'horizon de charge.

11) Tests à écrire :
    a) un compte avec UNE SEULE affaire accède à tout le produit, aucun écran bloquant ;
    b) avec moins de 3 affaires, aucune API ne renvoie de chiffre de marge ni d'horizon —
       le test vérifie qu'aucun nombre ne fuit dans la réponse ;
    c) déclarer un sous-traitant augmente le coût et ne change pas la capacité ;
    d) déclarer trois semaines d'absence pour deux personnes DÉPLACE la date de fin de
       charge annoncée. Si l'horizon ne bouge pas, les absences ne sont pas prises en
       compte et la promesse du produit est fausse ;
    e) isolation : deux tenants avec des reprises différentes, aucune donnée ne traverse
       sur les nouvelles colonnes ;
    f) vocabulaire : échec si "progression", "%", "complété" ou "étapes restantes"
       apparaît dans un libellé de reprise.

CE QUE TU NE DOIS PAS FAIRE
- N'implémente aucune reprise d'historique de factures ou de chantiers terminés.
- Ne demande jamais un chiffre d'affaires prévisionnel.
- N'affiche jamais un chiffre calculé sur des données insuffisantes.
- Ne transforme aucun bloc en étape obligatoire.
- Ne stocke aucun pourcentage d'avancement d'onboarding.
- N'oublie pas les trois listes à mettre à jour si tu crées une table.
```

---

## Après exécution — ce que tu vérifies toi-même

Trois choses, et elles ne demandent pas d'être développeur.

**Crée un compte avec le seul SIRET de ton frère, et essaie de créer une affaire.** Si un
écran te bloque, le principe central du 4.8 n'est pas respecté et il faut le redire à
l'agent.

**Saisis deux affaires, pas trois, et regarde l'écran de marge.** Il doit afficher
« données insuffisantes » et aucun chiffre. Si un zéro ou un pourcentage apparaît, le
seuil de silence n'est pas appliqué — et c'est le défaut qui décrédibilise le produit le
plus vite devant un artisan.

**Déclare trois semaines de congés pour deux personnes et regarde si la date d'horizon
recule.** Si elle ne bouge pas, la phrase « vous avez du travail jusqu'au 12 septembre »
est fausse, et c'est la promesse centrale du produit.

Et la mesure à noter chez tes trois pilotes : **le temps entre l'inscription et le premier
devis édité**. Sous dix minutes, c'est gagné. Au-delà de trente, dis-moi à quel écran ils
ont décroché.
