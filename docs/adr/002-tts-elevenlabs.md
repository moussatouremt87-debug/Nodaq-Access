# ADR 002 — Synthèse vocale : ElevenLabs, au prix d'un écart de souveraineté

**Date :** 2026-08-18
**Statut :** accepté, avec condition et critère de réversion
**Ticket :** 4.18 §1, US-2

## Le problème

L'agent doit parler français au téléphone, en temps réel, et donner
l'impression d'un interlocuteur humain. Un débiteur qui entend une voix
robotique raccroche, et l'artisan qui nous fait confiance perd la relation
qu'on lui promettait d'entretenir.

Quatre contraintes, et aucune solution ne les tient toutes :

| | Naturel | Français | Temps réel | Auto-hébergé |
|---|---|---|---|---|
| Kokoro-82M | ✗ | ✓ | ✓ | ✓ |
| Chatterbox Multilingual | ✓ | ✓ | **✗** | ✓ |
| Voxtral TTS (Mistral) | ? | **✗** | ✓ | ✗ |
| ElevenLabs Flash v2.5 | ✓ | ✓ | ✓ | **✗** |

## Ce qui a été mesuré, pas supposé

**Kokoro-82M** (Apache 2.0, voix `ff_siwis`) a été installé et fait générer les
trois répliques réelles du produit, converties en conditions téléphoniques
(300–3400 Hz, 8 kHz, G.711 µ-law). Temps réel sur CPU, aucun appel réseau.
Rejeté à l'écoute : trop synthétique.

**Chatterbox Multilingual V3** (MIT, Resemble AI) a été installé et mesuré sur
Apple Silicon en MPS :

| Réplique | Génération | Audio | Facteur |
|---|---|---|---|
| Annonce d'ouverture | 75,3 s | 8,6 s | ×8,8 |
| Demande de date | 15,6 s | 2,1 s | ×7,4 |
| Reformulation | 41,1 s | 6,2 s | ×6,6 |

Sept à neuf fois la durée de la phrase. Une conversation téléphonique demande
une réponse en quelques centaines de millisecondes : il manque trois ordres de
grandeur, ce qui n'est pas un réglage mais un changement de nature. Le modèle
reste utilisable hors ligne (message de répondeur pré-généré) ; pas en direct.

Deux réserves supplémentaires notées au passage : sa seule voix intégrée est
anglaise — le français y hérite d'un accent anglais, la documentation le dit
elle-même — et le paquet `resemble-perth` dont il dépend est cassé sous Python
3.12 (trois correctifs manuels avant le premier son).

**Voxtral TTS** dispose de dix voix, toutes anglaises. Aucune voix française.

## La décision

**ElevenLabs, modèle `eleven_flash_v2_5`** — ~75 ms annoncés, 32 langues dont le
français, sortie `ulaw_8000` native (le format même du trunk Twilio : aucune
conversion dans le chemin temps réel).

C'est le seul candidat qui tient à la fois le naturel et le temps réel. Le prix
est explicite : **on abandonne l'auto-hébergement**, donc la souveraineté, sur
cette couche.

## Le prix, dit sans le minimiser

ElevenLabs est une société **américaine**. Le texte des répliques y transite —
et ce texte contient des montants et des dates de règlement, parfois le nom du
débiteur. C'est une donnée personnelle, et elle sort du périmètre souverain que
la règle 1 du CLAUDE.md pose et que l'attestation d'US-A7.4 déclare.

Ce que la vérification du 18 août 2026 établit :

| Exigence | Disponibilité |
|---|---|
| DPA (art. 28, avec CCT) | **Self-service**, tous plans payants |
| Zero Retention Mode | **Enterprise seulement** |
| Résidence des données UE | **Enterprise seulement** — et le stockage seul ; le traitement peut sortir de la région sauf à combiner résidence **et** ZRM par l'API |

Les paliers self-service s'arrêtent à Business (990 $/mois) et n'ouvrent
aucune de ces deux portes.

**Condition d'usage en production :** sans Zero Retention Mode, ElevenLabs
conserve le texte envoyé. Deux voies acceptables, une seule à retenir avant
d'appeler un vrai débiteur :

1. souscrire **Enterprise** (ZRM + résidence UE), ou
2. rester en self-service **et minimiser** : garantir par construction que le
   texte envoyé ne contient jamais le nom du débiteur — seulement montants et
   dates. La couture existe (`texte_sans_identite`) ; elle demande une garde et
   une décision de l'appelant.

Le drapeau `zero_retention` est **faux par défaut** dans l'adaptateur. L'envoyer
sur un plan qui n'y donne pas droit n'accorde pas la garantie ; un défaut à
`true` ferait *revendiquer* au code une posture que le contrat ne fournit pas —
exactement le mensonge que l'attestation de souveraineté existe pour empêcher.

## Registre de souveraineté

ElevenLabs est déclaré dans `lib/shared/src/souverainete.ts` :

> ElevenLabs (États-Unis) — synthèse vocale. Reçoit le texte des répliques de
> l'agent, qui contient des données personnelles des débiteurs.

Sans cette inscription, l'attestation produite pour un donneur d'ordre
déclarerait trois sous-traitants là où il y en a quatre. Elle serait fausse, et
tout le dispositif d'US-A7.4 est construit pour rendre cela impossible.

## Critère de réversion

**Migration dès qu'un TTS souverain atteint la qualité cible.** Concrètement,
trois conditions simultanées :

1. voix française jugée naturelle à l'écoute, dans les conditions téléphoniques
   (8 kHz, G.711) — le même protocole que celui appliqué à Kokoro et Chatterbox ;
2. facteur temps réel **inférieur à 0,3** sur le matériel de production, mesuré
   sur les répliques réelles du produit ;
3. auto-hébergeable, ou hébergé dans l'Union européenne.

La revue est semestrielle. Kokoro et Chatterbox progressent vite ; ce qui est
vrai en août 2026 ne le sera pas forcément dans six mois.

**Le changement reste un changement d'adaptateur.** Le protocole
`voice.core.interfaces.TextToSpeech` ne connaît aucun fournisseur, et la garde
de couches (`services/voice/tests/test_layering.py`) interdit qu'un SDK
fournisseur entre dans `voice.core`. Migrer signifie écrire un fichier dans
`voice/adapters/` et changer une variable d'environnement — pas refondre l'agent.

## Licence des voix

Uniquement des voix de la **bibliothèque standard, avec droits commerciaux
inclus au plan**. Pas de *professional clone* d'un tiers sans avoir vérifié ses
conditions de partage : une voix clonée qui appelle des débiteurs engage la
personne qui l'a prêtée, et ce n'est pas une décision technique.

## Conséquences

- Un adaptateur `voice/adapters/elevenlabs_tts.py`, sans SDK fournisseur.
- Une entrée de plus au registre de souveraineté, donc à l'attestation.
- Une décision de plan à prendre avant tout appel réel (Enterprise, ou
  self-service avec minimisation).
- Voxygen et le casting de voix : abandonnés (pas de self-service).
