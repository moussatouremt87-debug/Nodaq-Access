# ADR 005 — Exécution vocale : ElevenLabs Agents, et ce qu'on cède en échange

**Date :** 2026-08-20
**Statut :** accepté
**Ticket :** 4.18-bis
**Amende :** ADR 001 (téléphonie), ADR 003 (latence), ADR 004 (sorties modèle)

## Le problème

L'exécution maison des lots 5-6 fonctionnait — neuf appels supervisés l'ont
prouvée de bout en bout — mais la latence ressentie entre la fin de parole du
débiteur et la réponse de l'agent restait rédhibitoire à l'oreille du fondateur,
après trois séries d'optimisations (amorce en cache, transcription en continu,
seuil de silence abaissé).

Le résiduel est structurel : notre chaîne exige une réplique complète et
vérifiée avant d'émettre le premier son, et chaque étage (fin de tour,
formulation, synthèse) s'additionne. Battre ce plancher — synthèse démarrée sur
les premiers mots, infrastructure au plus près de l'opérateur, tour de parole
affiné — est le métier des plateformes d'agents vocaux, pas celui d'un produit
de gestion pour artisans.

## La décision

**ElevenLabs Agents exécute la voix ; notre serveur décide.**

La plateforme prend : transport média (via l'intégration Twilio native),
transcription, formulation des répliques par son LLM, synthèse (notre voix
existante), tour de parole et interruption.

Notre serveur garde, via cinq server tools authentifiés par le jeton d'appel du
lot 6a : le mandat (`check_mandate`), l'enregistrement des promesses validées
contre le mandat (`record_promise`), la contestation (`record_dispute`), la
demande d'humain (`request_human_callback`), l'opposition (`set_do_not_call`).
L'annonce d'ouverture (US-2) reste produite mot pour mot par
`annonceOuverture()` et passée en variable dynamique.

## Le prix, dit sans le minimiser

### 1. La garde de pré-parole disparaît

Depuis le lot 5b, chaque phrase de l'agent était vérifiée **avant** d'être
prononcée : chiffre absent des faits, registre interdit, tutoiement, identité du
débiteur (`verifierReplique`). Sur ElevenLabs Agents, c'est leur LLM qui
formule : il n'y a plus de texte à intercepter avant la voix.

L'invariant applicable se déplace :

| | Avant (maison) | Après (Agents) |
|---|---|---|
| Montant hors mandat **prononcé** | impossible par construction | possible par dérive de prompt |
| Promesse hors mandat **enregistrée** | impossible | **impossible** — `record_promise` valide côté serveur |
| Violation de registre | bloquée avant parole | **détectée après coup** (audit du transcript) |

Compensations : consigne stricte dans le prompt versionné ; audit de
transcription post-appel rejouant `verifierReplique`/`registresInterdits` sur le
transcript reçu par webhook, marquage de l'appel et alerte cockpit en cas de
violation ; critères d'évaluation de la simulation alignés sur les mêmes
interdits. C'est du détectif, pas du préventif — le fondateur l'a arbitré en
connaissance.

### 2. La règle 2 est amendée une seconde fois

L'ADR 004 avait ouvert des sorties déclarées pour « ce qui transporte » en
gardant la formulation derrière `lib/llm`. Ce partage ne tient plus : **la
formulation elle-même part chez ElevenLabs**. La règle 2 se lit désormais :

- produit texte (chat, dictée, extraction, formulation de secours) :
  `LLM_BASE_URL`, inchangé, garde `llm-single-exit` active ;
- agent vocal : ElevenLabs Agents est une sortie modèle déclarée, nommée
  (`ELEVENLABS_API_KEY`), inscrite au registre de souveraineté.

La route `/relance/formulation` et ses gardes restent en place : elles servent
l'audit post-appel, et sont le chemin de réversion.

### 3. Souveraineté et rétention

ElevenLabs (États-Unis) reçoit désormais **l'intégralité de la conversation** :
audio des deux interlocuteurs, transcription, formulation. Vérifié le
20/08/2026 sur leur documentation :

- **Zero Retention Mode : Enterprise uniquement**, activable par agent, couvre
  le trafic API seulement. LLM compatibles : Gemini, Claude, Qwen hébergé.
- **Résidence EU : Enterprise uniquement** (environnement isolé).

Le compte actuel (self-service) n'a ni l'un ni l'autre : les conversations sont
conservées chez ElevenLabs. **Acceptable en phase de test vers les numéros de
l'équipe uniquement.** Avant toute exposition à un tenant : passage Enterprise,
ou acceptation écrite et documentée de la rétention par le fondateur.

## L'archivage de l'exécution maison

Tag `archive/execution-maison-2026-08` + branche
`archive/lot5-6-execution-maison`, puis retrait de `main` de `services/voice`
et de l'étape CI Python. Retrait et non cohabitation : les gardes de parité
Python↔TS casseraient à la première évolution du noyau, et une garde qu'on
laisse casser n'est pas une garde.

Ce qui reste sur `main`, parce que le pivot s'appuie dessus : le noyau de
décision, les gardes de formulation, le jeton par appel et sa policy RLS
(migration 044), les routes de mandat, l'opposition, l'effacement.

## Critère de réversion

Revenir à une exécution contrôlée (maison ou plateforme à texte imposé, type
Vapi custom-LLM) si l'audit post-appel révèle des violations de registre ou de
chiffres **répétées** que le prompt ne corrige pas — c'est-à-dire si le
détectif prouve que le préventif était nécessaire. La branche d'archive et la
route de formulation gardée rendent ce retour possible sans réécriture.

Revue conjointe avec celles des ADR 002/003, semestrielle.
