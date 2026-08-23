# Ticket 4.19 — Paiement immédiat par lien, à la suite d'un appel

**Ouvert le 2026-08-20.** État : **code livré, bloqué par une activation chez
le prestataire.**

## Le constat qui l'ouvre

Formulé par le fondateur après le premier appel supervisé réussi du 4.18-bis :

> « on doit pouvoir proposer un paiement immédiat via un lien généré suite à
> l'appel, c'est une vraie valeur ajoutée car un "oui oui je vais payer" ne
> vaut rien »

Une promesse verbale n'engage rien. Un lien envoyé pendant que la personne est
encore au téléphone est exécutable dans la minute.

## Rail retenu : virement Bridge

Bridge est déjà notre agrégateur bancaire (connecteur « Banque ») : pas de
nouveau prestataire, coût en centimes, et l'argent va **directement au compte
de l'artisan** — il ne transite jamais par nous. Écartés : Stripe (1,5 à 2,9 %
sur des factures parfois grosses, et un compte à créer par tenant) et la page
IBAN + QR (gratuite mais sans confirmation instantanée).

## Ce qui a été construit

| Lot | Contenu | PR |
|---|---|---|
| A | Table `liens_paiement` (RLS), validation d'IBAN ISO 13616 appliquée **par la route**, client `creerLienPaiement` dans `lib/banque-agreee` | #140 |
| B | `emettreLienPaiement` : montant, numéro, mandat et IBAN **tous lus en base**, SMS au numéro de la campagne | #141 |
| C | `send_payment_link` — 6ᵉ outil de l'agent, **sans aucun paramètre** | #142 |
| D | Webhook `payment.link.updated` → écriture dans `paiements`, registre de souveraineté amendé | #143 |
| E | Liste et renvoi des liens, carte « Liens de paiement » au cockpit | #143 |
| — | App Bridge dédiée au paiement + garde anti-doublon `.env.example` | #144 |

Trois invariants portés par le serveur, pas par le prompt :

1. **Le modèle ne fixe aucun montant.** L'outil ne prend aucun paramètre ; un
   corps arbitraire est ignoré, et un test l'éprouve.
2. **Le montant est figé à l'émission** — celui de la promesse enregistrée si
   elle existe, sinon celui de la facture. Le relire au paiement laisserait un
   lien changer de montant entre son envoi et son règlement.
3. **Renvoyer n'est pas ré-émettre.** Le SMS repart avec l'URL déjà créée :
   deux liens vivants pour une facture, c'est un double règlement possible, et
   c'est le débiteur qui le paierait.

## Ce qui bloque : le bénéficiaire dynamique

Constaté le 2026-08-20 au premier essai réel, en rejouant la requête pour lire
un motif que notre code ne journalise pas (le corps d'erreur peut reprendre
l'IBAN) :

```
HTTP 403 — payment_link.dynamic_beneficiary_not_allowed
« You are not allowed to create a payment link with a dynamic beneficiary.
  You can contact our team to enable this feature. »
```

Par défaut, un lien Bridge encaisse sur **un compte fixe** déclaré dans leur
dashboard. Désigner le bénéficiaire dans la requête — ce que nous faisons,
puisque chaque artisan doit recevoir sur SON IBAN — s'appelle « bénéficiaire
dynamique », et leur documentation le dit sans ambiguïté : *« This feature
needs to be activated by our teams. Please reach out to your CSM at Bridge. »*

**Ce n'est pas contournable.** Sans cette activation, tous les liens de tous
les tenants paieraient sur un seul et même compte — le produit ne peut pas
fonctionner ainsi. L'alternative envisagée puis écartée (retirer le
bénéficiaire pour éprouver le reste de la chaîne) n'aurait validé que le
transport, sur une branche jetable.

**Action en attente, côté compte** : demander l'activation du *dynamic
beneficiary* à Bridge, en décrivant l'usage — plateforme multi-entreprises où
chaque client encaisse sur son propre IBAN.

## Ce que l'essai supervisé a DÉJÀ prouvé

Appel réel du 2026-08-20, 48 secondes, vers le numéro du fondateur :

- annonce conforme (objet d'abord, « assistant automatique », transcription) ;
- conversation tenue : demande de date, conversion de « demain » en « le
  21 août », reformulation et demande de confirmation ;
- **appel de `send_payment_link`**, puis **reprise après échec** — l'agent a
  réessayé, puis pris congé en annonçant un envoi différé, sans jamais
  inventer de lien ni dicter d'adresse ;
- webhook post-appel reçu, transcription et audit écrits en base, aucune
  anomalie mécanique.

Autrement dit : toute la chaîne fonctionne, sauf la case à cocher chez le
prestataire.

## Pièges rencontrés, et ce qu'ils ont laissé derrière eux

- **Deux apps Bridge sous les mêmes noms dans `.env`.** `source` prend la
  dernière occurrence, les scripts du dépôt la première : une configuration
  qui dépend de son lecteur. D'où `scripts/verifier-bridge.mjs` et la garde
  anti-doublon.
- **`ELEVENLABS_PHONE_NUMBER_ID` contenant le numéro** (`+1661…`) au lieu de
  l'identifiant (`phnum_…`) : un appel refusé sans explication lisible. D'où
  `scripts/verifier-vocal.mjs`, qui contrôle la forme AVANT de composer.
- **L'idempotence du webhook ne tenait pas** à l'index unique comme je
  l'avais écrit : réécrire une ligne avec la valeur qu'elle porte déjà ne
  viole aucune contrainte. C'est la mise à jour conditionnelle
  (`WHERE statut <> 'PAYE'`) qui arbitre. Trouvé en éprouvant la garde.
