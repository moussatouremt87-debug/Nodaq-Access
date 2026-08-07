Tu vas construire l'émission des devis et des factures dans cette application
(Vite + React + shadcn + wouter + react-query côté front, Express 5 + Drizzle + Zod côté
back, PostgreSQL avec RLS actif).

C'est la partie RÉGLEMENTÉE du produit : les règles ci-dessous sont des obligations
légales françaises, pas des préférences. Ne les assouplis sous aucun prétexte, même si
ça simplifie le code.

RÈGLES TECHNIQUES DU DÉPÔT — sans exception
- Tout accès à une table métier passe par withTenant(tenantId, tx => ...). Aucune requête
  métier n'utilise `db` directement : une garde automatisée le vérifie.
- Le tenantId vient de la session (resolveTenant), JAMAIS du client.
- Toute entrée externe est validée par Zod.
- Si tu crées une table, mets à jour LES TROIS listes : BUSINESS_TABLES dans
  lib/db/scripts/migrate-rls.cjs, BUSINESS_TABLE_VARS dans
  artifacts/api-server/src/__tests__/rls.test.ts, et la boucle du test d'isolation.
- N'affiche jamais un secret ni une chaîne de connexion dans la sortie.
- Travaille en 5 phases. Arrête-toi à la fin de chacune, montre-moi le résultat et attends
  ma validation. Ne fais jamais deux phases d'un coup.

LA RÈGLE CENTRALE, À POSER AVANT TOUT LE RESTE
Un devis se modifie librement. Une facture ÉMISE ne se modifie JAMAIS et ne se supprime
JAMAIS. La numérotation doit être chronologique et continue, sans trou. Une correction
passe par une facture d'avoir qui référence la facture initiale.

═══════════════════════════════════════════════════
PHASE 1 — États, numérotation, verrouillage
═══════════════════════════════════════════════════

1) États :
   devis   : BROUILLON | ENVOYE | SIGNE | REFUSE | EXPIRE
   facture : BROUILLON | EMISE | PAYEE | ANNULEE_PAR_AVOIR
   avoir   : type de document distinct, avec sa propre séquence de numérotation.

2) Le numéro de facture est attribué À L'ÉMISSION, jamais à la création du brouillon.
   Séquence PAR TENANT, dans une table dédiée, incrémentée dans la MÊME transaction que
   l'émission, avec un verrou de ligne. Deux émissions simultanées ne doivent jamais
   produire le même numéro.

3) Verrouillage : toute écriture sur une facture EMISE est refusée au niveau de l'API ET
   par une contrainte en base. Pas seulement dans l'interface.

4) Trois tests obligatoires avant de passer à la suite — montre-les-moi au vert :
   - 20 émissions en parallèle → 20 numéros distincts et continus ;
   - créer puis supprimer 10 brouillons → aucun trou dans la séquence ;
   - toute tentative de modification d'une facture émise → refus.

═══════════════════════════════════════════════════
PHASE 2 — Rendu PDF : une seule chaîne
═══════════════════════════════════════════════════

5) Génération PDF CÔTÉ SERVEUR uniquement. L'aperçu affiche LE PDF RÉELLEMENT GÉNÉRÉ, pas
   une reconstitution HTML. Il est interdit d'avoir deux rendus différents entre ce que
   l'utilisateur valide et ce qui part.

6) Mentions obligatoires à porter sur les devis et les factures :
   identité complète et forme juridique · SIRET · numéro de TVA intracommunautaire ·
   numéro et date du document · identité et adresse du client · ADRESSE DU CHANTIER ·
   lignes détaillées avec quantité, unité et prix unitaire HT · taux et montant de TVA
   PAR LIGNE · totaux HT, TVA, TTC · conditions de règlement · pénalités de retard ·
   indemnité forfaitaire de 40 € · ASSURANCE DÉCENNALE (assureur, numéro de contrat,
   couverture géographique) · durée de validité pour un devis.

7) BLOCAGE : l'émission est IMPOSSIBLE s'il manque une mention obligatoire. Le message
   nomme la conséquence, pas seulement le champ :
   "Il manque votre numéro d'assurance décennale. Sans lui, cette facture n'est pas
    conforme et vous vous exposez à une amende."

═══════════════════════════════════════════════════
PHASE 3 — Factur-X et archivage
═══════════════════════════════════════════════════

8) Les factures sont générées en Factur-X : PDF/A-3 avec XML CII embarqué,
   PROFIL EN 16931. N'utilise NI MINIMUM NI BASIC WL : ils ne portent pas les lignes de
   facture et ne conviennent pas à des travaux.

9) Valide le XML produit contre le schéma EN 16931 dans un test automatisé.
   Si tu ne trouves pas de bibliothèque fiable, ARRÊTE-TOI ET DIS-LE au lieu de produire
   un XML approximatif : un Factur-X invalide est pire que pas de Factur-X du tout.

10) ARCHIVAGE : le PDF émis est stocké tel quel, avec son empreinte SHA-256.
    NE REGÉNÈRE JAMAIS un PDF de facture à l'affichage — sers le fichier archivé.
    Conservation 10 ans.

═══════════════════════════════════════════════════
PHASE 4 — TVA et spécificités bâtiment
═══════════════════════════════════════════════════

11) TVA PAR LIGNE, jamais globale. 20 %, 10 % et 5,5 % doivent pouvoir coexister sur un
    même document, avec trois bases et trois montants de TVA distincts, et un total juste
    au centime.

12) ATTESTATION TVA : dès qu'une ligne porte un taux réduit, exige l'enregistrement de
    l'attestation signée du client. Sans elle, avertissement bloquant à l'émission —
    c'est l'artisan qui doit la différence de TVA s'il ne la détient pas.

13) AUTOLIQUIDATION : case à cocher au niveau du document. Si elle est cochée, aucune TVA
    n'est appliquée et la mention "Autoliquidation — article 283-2 nonies du CGI" figure
    sur le document.

14) Les factures d'acompte sont des documents distincts.
    La retenue de garantie n'est PAS un impayé : elle ne doit jamais apparaître dans les
    relances ni dans les montants en retard.

═══════════════════════════════════════════════════
PHASE 5 — Envoi
═══════════════════════════════════════════════════

15) Crée une abstraction canal_emission avec deux implémentations :
    EMAIL (fonctionnelle) et PLATEFORME_AGREEE (bouchon explicite qui lève une erreur
    "non branché"). Cette abstraction est obligatoire : à partir du 1er septembre 2027 les
    factures devront transiter par une plateforme agréée, et sans elle ce sera une
    réécriture complète.

16) Envoi du devis par courriel, avec une page publique d'acceptation : case
    "Bon pour accord", nom du signataire, horodatage, adresse IP, et conservation du
    document accepté.
    N'implémente PAS de signature électronique qualifiée : inutile ici et très coûteux.

17) DÉLIVRABILITÉ : envoie depuis un domaine nodaq, avec le nom de l'artisan en nom
    d'affichage et son adresse en "répondre à".
    N'essaie PAS d'envoyer depuis son propre domaine : sans SPF/DKIM configurés chez lui,
    tout finit en indésirable.

18) Journalise chaque envoi (date, destinataire, canal, statut) SANS stocker le corps du
    message ni aucune donnée métier.

═══════════════════════════════════════════════════
TESTS À LIVRER EN FIN DE PARCOURS
═══════════════════════════════════════════════════
a) Immuabilité : modification d'une facture émise refusée, y compris par requête forgée.
b) Numérotation : 20 émissions parallèles → 20 numéros distincts et continus ;
   suppression de brouillons → aucun trou.
c) Aperçu : le document prévisualisé, le document envoyé et le document archivé sont
   identiques octet pour octet.
d) Conformité : chaque mention obligatoire retirée empêche l'émission (test énumératif).
e) Factur-X : le fichier produit est un PDF/A-3 et son XML valide contre EN 16931.
f) TVA : une facture à trois taux produit trois bases et trois montants corrects.
g) Attestation : ligne à taux réduit sans attestation → émission bloquée.
h) Avoir : référence obligatoirement une facture émise existante et ne peut pas dépasser
   son montant.
i) Isolation : un tenant ne voit ni les documents ni la séquence de numérotation d'un
   autre. La séquence est par tenant.

═══════════════════════════════════════════════════
CE QUE TU NE DOIS PAS FAIRE
═══════════════════════════════════════════════════
- Ne rends jamais modifiable ou supprimable une facture émise.
- N'attribue jamais un numéro à un brouillon.
- Ne produis pas deux rendus différents entre l'aperçu et le fichier envoyé.
- Ne regénère jamais un PDF de facture archivée.
- Ne produis pas un XML Factur-X approximatif : arrête-toi et signale-le.
- N'applique pas un taux de TVA global à tout un document.
- Ne mets pas la retenue de garantie dans les impayés.
- Ne déclare pas une phase terminée sans m'avoir montré les tests au vert.
