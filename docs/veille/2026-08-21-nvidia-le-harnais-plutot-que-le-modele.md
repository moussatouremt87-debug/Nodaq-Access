# Veille — « Le harnais, pas le modèle, est le vrai héros » (Nvidia, 21/08/2026)

**Source** : TechCrunch, 21/08/2026 —
<https://techcrunch.com/2026/08/21/nvidia-just-showed-that-the-harness-not-the-ai-model-is-now-the-real-hero/>

> Note relevée le 27/08/2026. L'article lui-même n'était pas atteignable depuis
> l'environnement (proxy d'egress) : le résumé ci-dessous est reconstitué à partir
> des reprises de presse et des résultats de recherche, pas d'une lecture directe.
> À vérifier sur la source avant d'en faire un argument public.

---

## Ce que dit l'étude

Nvidia a publié le 21/08/2026 des travaux montrant que, sur les tâches agentiques
**à horizon long**, l'enveloppe logicielle autour du modèle — le *harnais* — pèse
davantage que le choix du modèle lui-même.

Le harnais, c'est tout ce qui transforme un modèle brut en agent capable d'agir :
les outils qu'on lui donne, la gestion de la mémoire, et les règles qui encadrent
ce qu'il a le droit de faire.

**Le résultat marquant** : sur ARC-AGI-3 — un jeu de petits jeux 2D sans notice, où
l'agent doit découvrir les règles et gagner, comme le ferait un humain — Claude
Opus 5 passe de **30 %** (déjà le meilleur score parmi les modèles testés, sans
harnais) à **100 %** avec le harnais maison de Nvidia.

Ce harnais, appelé **AVO** (*Agentic Variation Operators*), repose sur deux pièces :

- une **gestion soignée de la mémoire** ;
- un **superviseur** : un agent d'observation distinct de l'exécutant, qui surveille
  ses actions, repère les approches qui n'aboutissent pas et lui impose un
  changement de stratégie.

Le choix du modèle compte encore — mais il est une part plus petite d'un système
agentique que ce que la plupart des utilisateurs supposent.

---

## Pourquoi ça nous concerne

Trois de nos règles non négociables disent déjà, sans le nommer, que la valeur est
dans le harnais. Cet article les conforte :

1. **Règle 2 — une seule sortie vers les modèles, nom du modèle en variable
   d'environnement.** Si le modèle est le composant remplaçable et le harnais
   l'actif durable, alors `LLM_BASE_URL` + nom de modèle configurable n'est pas
   seulement une précaution contre les dépréciations : c'est la bonne répartition
   de l'investissement. On ne construit pas sur un modèle, on construit autour.

2. **Règle 3 — le modèle ne calcule jamais, ne fixe jamais un prix.** C'est
   exactement une règle de harnais : la contrainte n'est pas dans le modèle, elle
   est dans l'enveloppe qui le borne (liste blanche d'outils, calcul déterministe
   côté serveur, `INTENTIONS_MONTANT_DICTABLE`).

3. **Règle 4 — écriture agentique = validation humaine.** Notre `pending_action`
   joue un rôle voisin de leur superviseur, à ceci près que le superviseur final
   est l'artisan, pas un second modèle. C'est un choix produit, pas une lacune :
   sur une facture, l'oversight doit être humain et annulable (règle 3 bis c).

**Piste à instruire, sans engagement** : nos échecs agentiques observés (ticket
4.23, l'agent qui répondait « je ne peux pas créer de factures ») étaient des
défauts de harnais — outillage manquant, garde-fou rédigé trop large — jamais des
défauts de modèle. L'étude Nvidia va dans le même sens et suggère qu'un mécanisme
de **détection de boucle improductive** (l'agent qui réessaie la même approche)
mériterait d'être regardé, côté harnais, avant tout changement de modèle.

---

## À vérifier avant de s'en servir

- Lire la publication Nvidia elle-même, pas seulement la reprise presse.
- ARC-AGI-3 est un banc de jeux 2D : la transposition à un métier de gestion
  (devis, facture, trésorerie) n'a rien d'automatique. Ne pas citer le « 30 % →
  100 % » comme s'il valait pour notre domaine.
