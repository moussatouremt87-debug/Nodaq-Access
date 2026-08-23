# Tickets 4.x — index et état

> État arrêté au **23/08/2026**, issu de l'audit complet de cette date. Le dépôt
> est alors à `ce8da25`.
>
> **Pourquoi cet index existe.** L'audit du 23/08 a constaté que le code citait
> vingt-six tickets dont cinq seulement vivaient dans le dépôt : les autres
> n'existaient que dans un historique de conversation. Un audit ne pouvait donc
> pas vérifier la conformité au texte, seulement décrire ce que le code fait.
> Tous les tickets dont j'ai reçu l'énoncé sont désormais versionnés ici.

---

## Convention de nommage

`docs/tickets/4.XX-nom-court.md`. Les cinq fichiers antérieurs, nommés
`ticket-4.XX-*.md`, ont été renommés par `git mv` — l'historique est conservé.

Le lot `lot-retours-test-2026-08-22.md` a été **éclaté en onze fichiers**, un par
ticket. Chacun reprend son texte sans modification, plus la correction de
prémisse qui le concerne et le rappel des trois règles produit du lot.

---

## Trois collisions de numéro, et comment elles sont tranchées

Trois numéros désignaient **deux tickets différents chacun** : un dans le dépôt,
un dans les fichiers transmis. Arbitrage du 23/08 : **le dépôt fait foi**, parce
que ses numéros sont cités dans le code, dans des messages de commit fusionnés
et dans des descriptions de pull request — toutes choses qu'on ne réécrit pas.

| Numéro | Conservé (dépôt) | Renuméroté (transmis) |
|---|---|---|
| 4.19 | Paiement immédiat par lien — 32 citations | → **4.39** Speed-to-lead |
| 4.21 | La voix fait TOUT — 27 citations | → **4.38** Lien de paiement sur facture + réconciliation |
| 4.22 | Flottement de la suite — 3 citations | → décalage du lot de retours, ci-dessous |

Le lot de retours de test existait en deux numérotations décalées d'un cran :
**4.22 → 4.32** dans le fichier d'origine, **4.23 → 4.33** dans le dépôt. La
seconde est retenue — c'est celle que porte tout le code.

> **Dette de traçabilité assumée.** Les commits et la PR #179 (QR de virement
> SEPA) citent le ticket 4.38 sous son ancien numéro 4.21. Ils ne sont pas
> réécrits. Cet index est le seul endroit où la correspondance est établie.

---

## État par ticket

Légende : **FAIT** · **PARTIEL** · **NON FAIT** · **BLOQUÉ** (hors de notre main).

| Ticket | Sujet | État au 23/08 | Ce qui manque |
|---|---|---|---|
| [4.15](4.15-durcissement-acces-lecture.md) | Durcissement des accès à privilèges | FAIT | — |
| [4.18](4.18-agent-vocal-sortant.md) | Agent vocal sortant | REMPLACÉ | Pivot vers 4.18-bis ; les US-1 à US-9 restent le contrat |
| [4.18-bis](4.18bis-elevenlabs-agents.md) | Exécution vocale ElevenLabs | PARTIEL | `ELEVENLABS_AGENT_ID` absent du `.env` — non configuré |
| [4.19](4.19-liens-paiement.md) | Paiement immédiat par lien | BLOQUÉ | Bridge refuse le bénéficiaire dynamique (403) depuis le 20/08 |
| [4.20](4.20-mobile.md) | L'application au doigt | PARTIEL | Lot A livré ; lots B, C, D différés volontairement |
| [4.21](4.21-voix-integrale.md) | La voix fait TOUT | PARTIEL | `scripts/couverture-vocale.mjs` jamais écrit — dette que le ticket s'écrit à lui-même |
| [4.22](4.22-flottement-suite.md) | Flottement de la suite | FAIT | — |
| [4.23](4.23-agent-operateur.md) | L'agent refuse de faire son métier | PARTIEL | L'éval sur les 20 tâches produit |
| [4.24](4.24-commande-vocale.md) | La commande vocale | FAIT | — |
| [4.25](4.25-pdf-telechargeables.md) | Documents PDF | PARTIEL | Le PDF de **contrat** |
| [4.26](4.26-annulation-paiement.md) | Action irréversible | FAIT | — |
| [4.27](4.27-invitations-comptable.md) | Invitation du comptable | **PARTIEL — grave** | L'envoi marche ; l'écran d'état, le renvoi et le lien de secours manquent |
| [4.28](4.28-champs-numeriques.md) | Champs numériques | PARTIEL | 31 champs `type="number"` bruts restants |
| [4.29](4.29-vocabulaire-artisan.md) | Vocabulaire | FAIT | — |
| [4.30](4.30-navigation-compteurs.md) | Navigation | PARTIEL | Le test e2e qui suit chaque lien compteur |
| [4.31](4.31-coherence-chantiers-heures-classeur.md) | Cohérence | **PARTIEL — grave** | Aucun document n'est indexé au Classeur |
| [4.32](4.32-ecran-integrations.md) | Écran d'intégrations | NON FAIT | La refonte en logique de bénéfice |
| [4.33](4.33-relance-etapes-commerciales.md) | Relance commerciale | FAIT | — |
| [4.34](4.34-signature-electronique.md) | Signature électronique | NON FAIT | Aucune trace dans le code |
| [4.35](4.35-gestion-dechets-devis.md) | Gestion des déchets (AGEC) | FAIT | — |
| [4.36](4.36-emprunts-execution-obat.md) | Trois emprunts d'exécution | FAIT | Lots A, B, C livrés et branchés à l'écran le 23/08 |
| [4.37](4.37-pdp-iopole-facturation-electronique.md) | PDP / facturation électronique | BLOQUÉ | Contrat à signer avant le 1ᵉʳ septembre 2026 |
| [4.38](4.38-lien-paiement-facture-et-reconciliation.md) | Lien de paiement + réconciliation | PARTIEL | QR de virement livré (#179) ; import de relevé et échéancier absents |
| [4.39](4.39-speed-to-lead.md) | Speed-to-lead | NON FAIT | Dépend du 4.18-bis, non configuré |
| **4.40** | **Tuiles cliquables** | **TEXTE NON TRANSMIS** | Voir ci-dessous |

---

## Ce qui manque encore à ce dossier

**4.40 — tuiles cliquables.** Annoncé comme « dans la conversation » par le plan
post-audit. Recherché le 23/08 dans les deux sessions du projet, sur toutes les
occurrences de « tuile » et « cliquable », côté fondateur comme côté assistant :
**aucun énoncé de ticket**. Les seules occurrences sont incidentes — les tuiles
du cockpit, les tuiles de l'écran d'intégrations. Le numéro 4.40 lui est
réservé ; le texte reste à coller.

Ne pas le reconstruire de mémoire : un ticket inventé qu'un index présente comme
authentique est précisément ce que ce dossier existe pour empêcher.

**Le backlog US-A\*.** Vingt-sept user stories (`US-A1.1` … `US-A8.4`) sont
citées dans le code et ne sont versionnées nulle part. Elles souffrent du même
mal que les tickets 4.x avant aujourd'hui : leur conformité n'est pas
vérifiable. Le fichier existe côté fondateur
(`backlog-user-stories-tpe-pme-v3`) ; il n'a pas été versionné ici faute d'être
demandé.

---

## Écarts entre le plan post-audit et le dépôt

Relevés le 23/08 en lisant le plan, à corriger dans les prompts avant de les
lancer — chacun ferait échouer ou dévier le travail :

| Le plan dit | Le dépôt est |
|---|---|
| « migration Prisma » | **Drizzle** + fichiers SQL numérotés dans `lib/db/migrations/` |
| `pnpm lint` | **N'existe pas.** Scripts : `build`, `typecheck`, `db:setup`, `db:migrate` |
| `apps/agent-runtime` | `artifacts/api-server` — il n'y a pas de dossier `apps/` |
| « le bus d'événements (#86) existant » | **N'existe pas.** L'invalidation passe par React Query |
| `rgpd-security-reviewer` | **Aucun sous-agent** n'est défini dans ce dépôt ; la revue RGPD est manuelle |
| « agent réel (LiteLLM, modèle de dev) » | `LITELLM_*` est **interdit** (règle 2). La sortie unique est `LLM_BASE_URL` via `lib/llm`, et la CI ne dépend d'aucun secret |
| « 4.22-agent-operateur.md » | C'est **4.23** ; 4.22 est le flottement de la suite |

---

## Hors dépôt, et hors de la main de Claude Code

- **Mail IOPOLE (PDP)** — à envoyer avant le 1ᵉʳ septembre 2026.
- **Relance Bridge** — activation du *dynamic beneficiary*, dossier commercial.
- **`ELEVENLABS_AGENT_ID`** — à renseigner dans le `.env`.
