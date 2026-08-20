# Ticket 4.18-bis — Pivot de l'exécution vocale vers ElevenLabs Agents

**Date :** 2026-08-20
**Statut :** validé (plan approuvé par le fondateur le 20/08/2026)
**Remplace :** l'exécution vocale des lots 5-6 du ticket 4.18 (archivée, voir §1)
**Ne remplace pas :** les US-1 à US-9 du ticket 4.18, qui restent le contrat
fonctionnel intégral.

> Ce fichier versionne les décisions fondateur transmises le 20/08/2026. Il est
> la référence du chantier ; le plan d'exécution détaillé et les réponses
> sourcées aux cinq questions vivent dans l'ADR 005 et dans l'historique du
> dépôt.

## Contexte des décisions fondateur

- L'exécution maison est **abandonnée** : neuf appels supervisés ont validé la
  chaîne de bout en bout, mais la latence ressentie est rédhibitoire, et la
  battre est le métier des plateformes spécialisées — pas le nôtre.
- Les lots 1-4 mergés (modèle de données, `pending_action`, mandat, écrans,
  effacement) sont **intouchables** : c'est le produit.
- Plateforme retenue : **ElevenLabs Agents**. La voix existe (Voice Design), le
  compte existe, la clé est configurée. Le trunk/numéro Twilio existant se
  branche par leur intégration native.

### Correction de périmètre (constatée au planning)

Le brief fondateur mentionnait du « code LiveKit » à archiver : il n'y en a
jamais eu. Les lots 5-6 ont construit Twilio Media Streams en direct, une
transcription temps réel et une boucle d'appel (`services/voice`). C'est cela
qui est archivé. À l'inverse, le jeton par appel, les routes de mandat,
l'opposition et l'effacement (lot 6a, TypeScript) **survivent au pivot** et en
sont les fondations.

## Architecture cible

ElevenLabs Agents exécute la voix (transport média, transcription, formulation
des répliques, synthèse, tour de parole). Notre serveur garde **toutes les
décisions**, exposées à l'agent par cinq server tools :

| Tool | Décision couverte |
|---|---|
| `check_mandate` | ce que l'agent a le droit d'accorder (US-3, US-9) |
| `record_promise` | promesse validée contre le mandat, jamais hors bornes (US-3) |
| `record_dispute` | contestation enregistrée, jamais discutée (US-4) |
| `request_human_callback` | demande d'humain, escalade (US-2) |
| `set_do_not_call` | opposition définitive, effective immédiatement (US-7) |

Chaque tool s'authentifie par le **jeton de l'appel en cours** (lot 6a),
transmis en variable dynamique secrète : le tenant est résolu depuis la ligne en
base, jamais depuis le corps de la requête.

## Exigences non négociables

1. **Config as code** : l'agent ElevenLabs est défini dans le dépôt et appliqué
   par script via leur API. Jamais de dashboard manuel.
2. **L'annonce (US-2) reste produite par notre serveur** (`annonceOuverture()`),
   passée en variable dynamique — la plateforme la prononce, ne la rédige pas.
3. **Aucun appel hors `pending_action` approuvée**, y compris pour tester.
4. **Liste blanche de numéros de test** tant que le numéro sortant est
   américain.
5. **Aucun appel réel sans feu vert explicite du fondateur** ; le premier appel
   supervisé se fait vers son numéro personnel uniquement.
6. Registre de souveraineté, ADR et attestation **à jour avant** toute
   exposition à un tenant.
7. Revue RGPD manuelle avant merge de chaque lot (le sous-agent dédié n'existe
   pas dans cet environnement).

## Le prix structurel, assumé (détail dans l'ADR 005)

Le LLM de la plateforme formule les répliques : la vérification de chaque phrase
**avant** qu'elle soit prononcée (chiffres non fournis, registres interdits,
tutoiement, identité) ne peut plus s'appliquer. L'invariant applicable se
déplace de « l'agent ne *dit* jamais un montant non accordé » vers « l'agent ne
peut jamais *enregistrer* une promesse hors mandat », complété par un **audit de
transcription post-appel** qui rejoue les gardes existantes sur le transcript et
alerte en cas de violation.

## Clause de sortie

Si l'outillage de simulation d'ElevenLabs Agents se révèle inutilisable pour
rejouer nos scénarios automatiquement, évaluer Retell AI **avant** d'implémenter
en profondeur. Vérification du 20/08/2026 : l'API de simulation existe
(multi-tours, bouclage des tools, critères d'évaluation) — la clause ne se
déclenche pas à ce jour. L'interface de déclenchement d'appel doit néanmoins
rester réversible.

## Coûts (vérifiés le 20/08/2026, à réviser à chaque changement de plan)

- ElevenLabs Agents : 0,10 $/min (Creator/Pro), 0,08 $/min (Business annuel),
  hors LLM (absorbé par ElevenLabs à cette date) et hors téléphonie Twilio.
- Référence Retell si clause de sortie : ≈ 0,11 $/min tout compris.
- Le coût par appel alimente `cout_millicents` (existant) pour la tarification à
  l'usage du pricing v2, ventilé plateforme/téléphonie.
