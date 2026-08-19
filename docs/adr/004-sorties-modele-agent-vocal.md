# ADR 004 — Les sorties vers les modèles de l'agent vocal

**Date :** 2026-08-19
**Statut :** accepté
**Ticket :** 4.18 §1
**Amende :** règle 2 du `CLAUDE.md` (« une seule sortie vers les modèles »)

## Le problème

La règle 2 dit que **toute** destination de modèle vient de `LLM_BASE_URL`,
résolue dans `lib/llm`, et `llm-single-exit.test.ts` la fait respecter.

Elle a été écrite pour le produit texte, où elle a un sens simple : une requête,
une réponse, une porte. L'agent vocal ne peut pas la tenir sous cette forme, et
il faut le dire plutôt que de contourner la garde en silence.

## Ce que la mesure a établi

Mesures du 19 août 2026, français, µ-law 8 kHz, entre la fin de parole du
débiteur et le résultat exploitable :

| Transcription | Délai après la fin de parole |
|---|---|
| en lot, par requête HTTP (`lib/llm`, Whisper large v3) | **1 417 ms** |
| en continu, connexion permanente (`gpt-live-transcribe`) | **154 ms** |

Mille deux cents millisecondes d'écart, ajoutées à chaque tour de parole. Une
conversation téléphonique tolère 200 à 500 ms au total : la transcription en lot
consomme à elle seule le double du budget, avant même que le modèle ait réfléchi.

La différence n'est pas un réglage. Une transcription en lot ne peut commencer
qu'une fois la phrase finie ; une transcription en continu travaille pendant
qu'on parle et ne paie que la fin. Aucun choix de fournisseur ne referme cet
écart — c'est la forme de l'échange qui le crée.

Or `lib/llm` ne connaît que des requêtes ponctuelles. Une connexion permanente
n'y entre pas, et l'y faire entrer reviendrait à réécrire `lib/llm` autour d'un
besoin qui n'est pas celui du produit texte.

## La décision

**La règle 2 est précisée, pas abandonnée.** Elle continue de s'appliquer
intégralement à tout ce qui **engage l'entreprise** ; elle cesse de s'appliquer
au transport de la voix.

| Ce que fait l'agent | Sortie | Pourquoi |
|---|---|---|
| **Formuler une réplique** | `lib/llm`, via `POST /relance/formulation` | C'est ce que l'entreprise DIT. Le texte y est vérifié avant d'être prononcé — chiffres, registre, tutoiement, identité du débiteur. |
| **Décider** (mandat, insistance, échelonnement) | aucun modèle | `decisionAppel.ts`, pur et testé. |
| **Transcrire** | sortie déclarée du worker | Connexion permanente, impossible par requête ponctuelle. |
| **Synthétiser** | sortie déclarée du worker | Flux audio sortant, même raison. |

Le partage n'est pas technique, il est **contractuel** : ce qui peut créer un
engagement passe par la porte gardée ; ce qui transporte du son a la sienne,
nommée et testée.

## Ce qui reste garanti

L'essentiel ne bouge pas. Le worker **ne formule rien** : il ne porte ni
consigne, ni nom de modèle de conversation, ni clé vers `LLM_BASE_URL`, et
`test_formulation_http.py` vérifie qu'aucun de ces mots ne traverse la
frontière. Un chiffre prononcé vient toujours des faits transmis par le serveur,
et `chiffresInventes` le refuse sinon.

Ce que l'agent PRONONCE reste donc contrôlé phrase par phrase, exactement comme
avant cet ADR.

## Ce qu'on refuse, et pourquoi

**Le voix-à-voix** — un modèle qui écoute et répond en audio, sans texte
intermédiaire. Mesuré le même jour : **1 394 ms** contre **~1 355 ms** pour la
chaîne texte avec transcription en continu. À latence égale, il supprime la
seule chose qui protège l'entreprise : il n'y a plus de texte à vérifier avant
qu'il parle.

Le modèle réduit (`gpt-realtime-2.1-mini`) a d'ailleurs répondu, sur le premier
essai, en se mettant à la place du débiteur — « je peux pas tout régler tout de
suite ». Dans un appel de recouvrement, l'agent qui déclare ne pas pouvoir payer
met fin à la conversation et à la crédibilité de celui qui appelle. Aucune garde
n'aurait pu l'attraper.

Le voix-à-voix ouvrirait par ailleurs exactement la même sortie supplémentaire :
il ne résout pas le problème de la règle 2, il l'a aussi.

## Conséquences

- Les sorties du worker sont **déclarées et nommées** : `VOICE_STT_*`,
  `VOICE_TTS_*`. Aucune ne porte le nom d'un fournisseur (`llm-single-exit`
  demande qu'une variable dise de quel service elle parle).
- `llm-single-exit.test.ts` continue de balayer `artifacts/` et `lib/`, où la
  règle 2 s'applique sans réserve. `services/` en est hors champ **par cette
  décision**, et non par oubli.
- Chaque sortie du worker est un sous-traitant à déclarer au registre de
  souveraineté si l'attestation est conservée — voir la note ci-dessous.

## Note de contexte

Cet ADR est écrit le jour où l'argument commercial de souveraineté des données
a été abandonné. Il ne s'appuie pas dessus : le partage retenu tient par la
distinction entre **ce qui engage** et **ce qui transporte**, qui reste vraie
quel que soit le pays d'hébergement.

Le sort de l'attestation d'US-A7.4 — conservée, recentrée ou retirée — est une
décision produit distincte, qui n'a pas encore été prise.
