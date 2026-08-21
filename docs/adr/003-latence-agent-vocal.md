# ADR 003 — Latence de l'agent vocal : remplir le blanc, un seul modèle en ligne

**Date :** 2026-08-19
**Statut :** accepté — **rendu caduc par l'ADR 005 (20/08/2026)** : la
latence d'exécution appartient désormais à la plateforme. Les mesures et
le raisonnement restent la référence si la réversion est un jour exercée.
**Ticket :** 4.18 §1

## Le problème

Entre la fin de la phrase du débiteur et le premier son de l'agent, il s'écoule
plus d'une seconde. Une conversation téléphonique tolère 200 à 500 ms : au-delà,
l'autre relance (« allô ? ») ou se demande à qui il parle.

## Ce qui a été mesuré, pas supposé

Mesures du 19 août 2026, sortie `ulaw_8000`, moyennes sur 3 à 4 appels réels.

| Étape | Durée |
|---|---|
| Le modèle formule la réplique (complète) | ~650 ms *(412–1 084)* |
| Gardes de sortie (`verifierReplique`) | négligeable |
| `eleven_flash_v2_5` — premier octet | 505 ms *(avec `optimize_streaming_latency=3`)* |
| `eleven_flash_v2_5` — premier octet, sans le paramètre | 676 ms |
| `eleven_v3` — premier octet | 1 139 ms |

**Blanc total : 1,15 s en Flash, 1,79 s en v3.**

`eleven_v3` **refuse** `optimize_streaming_latency` — l'API rend 400. Il n'est
donc pas accélérable.

## La contrainte qu'on ne lève pas

Les gardes de `formulation.ts` exigent la réplique **entière** avant qu'elle soit
prononcée : registre, longueur, tutoiement, et surtout l'interdiction de
prononcer un chiffre qui ne vient pas des faits.

Streamer le modèle vers la synthèse supprimerait ~650 ms — et supprimerait les
gardes avec. Une garde qui s'applique après que la moitié de la phrase est déjà
sortie n'est pas une garde. **On ne raccourcit donc pas la chaîne.**

## La décision

**On remplit le silence** avec une amorce (« Alors… euh, ») synthétisée une fois
au démarrage et rejouée depuis la mémoire — jamais depuis le disque, celui d'un
conteneur étant éphémère. La jouer ne coûte que sa durée.

**Un seul modèle dans la ligne, le rapide.** L'amorce est produite par le même
adaptateur que le corps de la réplique.

## L'arbitrage écouté, et pourquoi le plus lent a été écarté

Deux montages ont été fabriqués et écoutés en conditions téléphoniques :

| | Amorce | Durée de l'amorce | Blanc résiduel | Latence ajoutée |
|---|---|---|---|---|
| **B** | `eleven_v3` | 1,60 s | 0 | **+450 ms** |
| **C** | `eleven_flash_v2_5` | 0,93 s | 0,22 s | 0 |

**C retenu**, pour trois raisons.

L'amorce v3 dure **plus longtemps que le blanc qu'elle couvre**. Quand le modèle
répond normalement, la réplique est prête à 1,15 s mais ne peut pas démarrer
avant la fin de l'amorce : le remède devient le goulot, et l'agent est plus lent
qu'avant le correctif.

Les 0,22 s restantes de C tombent **après** « Alors… euh, » — c'est-à-dire là où
une hésitation humaine marque un temps. C'est la forme du silence, pas un défaut.

Enfin, un seul modèle supprime tout risque de **couture audible** en milieu de
tour de parole, et l'expressivité de v3 a peu de prise sur un mot de remplissage
d'une seconde : elle se joue sur l'intonation d'une phrase qui porte du sens.

## Conséquence sur le choix de voix

L'ADR 002 conclut à ElevenLabs pour le naturel. Le présent ADR précise que le
naturel entendu en ligne est celui de **Flash**, pas de v3 : v3 reste hors du
chemin temps réel.

Si la différence de timbre devenait rédhibitoire à l'écoute, la sortie n'est pas
de basculer la ligne sur v3 — ce serait +634 ms — mais de **raccourcir le texte
de l'amorce** pour que sa version v3 tombe sous 1,15 s.

## Critère de réversion

Repasser v3 en ligne le jour où son temps au premier octet descend **sous
600 ms**, mesuré sur les répliques réelles du produit, dans les conditions
téléphoniques. Revue avec celle de l'ADR 002, semestrielle.

## Ce que ça n'adresse pas

Le puits audio réel : `play()` parcourt le cache, le branchement sur LiveKit
arrive au lot 6. Ce qui est garanti dès maintenant, c'est qu'**aucune synthèse
n'a lieu pendant l'appel**.

La variance du modèle : 412 à 1 084 ms observés. L'amorce couvre la moyenne,
pas le pire cas. Un appel supervisé dira si le pire cas s'entend.
