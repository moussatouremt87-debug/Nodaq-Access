# ADR 001 — Téléphonie : Twilio Elastic SIP Trunking

**Date :** 2026-08-18
**Statut :** accepté, avec réserve — **amendé par l'ADR 005 (20/08/2026)** :
le trunk SIP décrit ici n'est plus dans le chemin d'exécution ; le numéro
Twilio se branche désormais sur ElevenLabs Agents par leur intégration
native. La réserve de souveraineté demeure, élargie par l'ADR 005.
**Ticket :** 4.18 §6

## Contexte

L'agent vocal sortant a besoin d'un opérateur pour composer des appels. Le
ticket impose de passer par un trunk SIP branché sur LiveKit, derrière
l'interface `TelephonyProvider`.

Telnyx avait été retenu initialement. Le compte a été bloqué par leur système
anti-fraude — vérification impossible malgré SMS, appel et support —, il a été
abandonné et le solde remboursé.

## Décision

**Twilio Elastic SIP Trunking**, trunk `nodaq-voice-agent`.

Configuration en place :

| Élément | Valeur | Variable |
|---|---|---|
| Termination SIP URI | `nodaq.pstn.twilio.com` | `TELEPHONY_SIP_HOST` |
| Credential | `nodaq-agent` | `TELEPHONY_SIP_USER` |
| Mot de passe | gestionnaire de secrets | `TELEPHONY_SIP_PASS` |
| Numéro de développement | un numéro **US (+1)** | `TELEPHONY_CALLER_ID` |
| Geo Permissions | France + Émirats arabes unis | — |

## La réserve, et elle est sérieuse

**Twilio est un fournisseur américain.** Le média voix transite par son
infrastructure, alors que les conversations d'un appel de relance sont classées
`confidentiel` — elles portent le nom d'un débiteur, le montant qu'il doit, et
souvent la raison pour laquelle il n'a pas payé.

C'est un écart par rapport à la règle 1 du CLAUDE.md (données hébergées en
France) et par rapport à la logique de l'attestation de souveraineté
(US-A7.4), qui déclare aujourd'hui trois sous-traitants tous situés en France.

Cet écart est **assumé pour la phase de développement**, où les seuls appels
possibles vont vers les téléphones de l'équipe. Il ne l'est **pas** pour la
production, et deux choses doivent avoir lieu avant :

1. **Vérifier et consigner la configuration de résidence des données EU de
   Twilio.** Twilio propose une région irlandaise pour certains produits ; il
   faut établir ce qu'elle couvre exactement pour l'Elastic SIP Trunking, et ce
   qu'elle ne couvre pas.
2. **Mettre à jour le registre de souveraineté** (`lib/shared/src/souverainete.ts`)
   pour y déclarer l'opérateur téléphonique. L'attestation d'US-A7.4 refuse
   d'émettre quand la configuration diverge du registre : ajouter un
   sous-traitant sans l'y inscrire produirait une attestation **fausse**, ce
   que tout le dispositif est fait pour empêcher.

La migration vers un opérateur français — OVHcloud a été évoqué — reste couverte
par l'interface `TelephonyProvider`, et la garde de couches
(`services/voice/tests/test_layering.py`) garantit qu'aucun module métier
n'importe le SDK d'un opérateur.

## Le numéro français est différé

Un numéro français exige un dossier réglementaire : justificatif d'adresse en
France, et pour un 01–05, une adresse dans la zone géographique. À constituer
quand la structure française sera actée, idéalement en bundle « Business » au
nom de la société.

**Conséquence opérationnelle, écrite ici pour qu'on ne l'oublie pas :** l'agent
ne doit appeler aucun débiteur français depuis le numéro US. Le taux de
décroché l'interdit autant que le bon sens — un artisan dont le client reçoit
un appel d'un +1 inconnu perd la confiance qu'on lui vendait.

## Conséquences

- `TELEPHONY_*` documentées dans `.env.example`, mot de passe jamais commité.
- Le worker vocal ne connaît Twilio que par un adaptateur ; le noyau ne le
  connaît pas du tout.
- Deux tâches ouvertes avant toute mise en production : l'étude de résidence EU,
  et l'inscription de l'opérateur au registre de souveraineté.
