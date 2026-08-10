/**
 * Garde du lot « flottements » — et mémoire de ce qui a été mesuré.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  CE FICHIER EXISTE POUR QU'ON NE REFASSE PAS L'ENQUÊTE DEPUIS ZÉRO.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ── Les faits ───────────────────────────────────────────────────────────────
 * Cinq échecs intermittents, sur cinq tests DIFFÉRENTS, toujours pendant un
 * `pnpm -r` qui lance les paquets en parallèle, jamais en exécution isolée.
 *
 * Taux mesuré : 0 échec sur 5 exécutions du seul api-server ; 1 sur 10 en
 * exécution parallèle des paquets.
 *
 * ── Deux familles, et une seule est expliquée ───────────────────────────────
 *
 * FAMILLE 1 — `read ECONNRESET` (errno -54, syscall 'read', `response:
 * undefined`). Aucune réponse du serveur : la requête meurt dans le transport.
 * Trois des cinq échecs.
 *
 * Cause : la contention sur les ports éphémères de la boucle locale. Supertest
 * monte un serveur `app.listen(0)` PAR REQUÊTE et ouvre une connexion neuve
 * (superagent impose `agent: false`, donc aucune mise en réserve). La suite
 * compte plus de 300 appels `request(app)` ; les huit paquets lancés ensemble
 * puisent tous dans la MÊME réserve de ports, qui est une ressource de la
 * machine et non du processus.
 *
 * Mesure : 5000 cycles (listen → requête → close) en isolation donnent 0 échec ;
 * les mêmes cycles à huit processus simultanés épuisent la réserve et rendent
 * `EADDRNOTAVAIL`. Sous une pression moindre — celle de la vraie suite — le
 * même épuisement se manifeste par des connexions réinitialisées.
 *
 * FAMILLE 2 — le serveur A RÉPONDU, mais mal : un 404 au lieu d'un 200 dans
 * `agent.test.ts`, une émission sur vingt sans numéro dans `facturation.test.ts`.
 * Ce ne sont PAS des erreurs de transport, et elles restent INEXPLIQUÉES.
 *
 * Aucun correctif n'a été écrit pour la famille 2. Le seul geste posé est de
 * cesser de détruire la preuve : `facturation.test.ts` rapporte désormais le
 * statut et le corps de la réponse fautive au lieu de la filtrer.
 *
 * ── Une piste écartée, pour qu'on ne la reprenne pas ────────────────────────
 * `http.globalAgent` porte `keepAlive: true` depuis Node 19, et le recyclage
 * d'une socket éventée produit EXACTEMENT cette signature — reproduit à 200/200.
 * Cette piste est pourtant fausse ici : superagent pose `_agent = false` et
 * n'emprunte jamais l'agent global. Désactiver le keep-alive est sans effet sur
 * cette suite.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(__dirname, "../../../..");

/** Tous les `vitest.config.*` du dépôt, hors `node_modules`, `dist` et `.git`. */
function configsVitest(depuis: string = RACINE, trouves: string[] = []): string[] {
  for (const entree of readdirSync(depuis)) {
    if (entree === "node_modules" || entree === "dist" || entree === ".git") continue;
    const complet = path.join(depuis, entree);
    if (statSync(complet).isDirectory()) configsVitest(complet, trouves);
    else if (/^vitest\.config\.[cm]?ts$/.test(entree)) trouves.push(complet);
  }
  return trouves;
}

describe("flottements de la suite", () => {
  test("aucune configuration vitest ne réessaie un test qui a échoué", () => {
    // `retry` est la façon la plus efficace de faire disparaître ce dossier
    // sans rien réparer. Il ferait taire la famille 1, dont on connaît la cause
    // et qu'on traite en amont — mais AUSSI la famille 2, qui vient du serveur
    // et reste inexpliquée. Un flottement réessayé jusqu'au vert n'est pas un
    // flottement résolu : c'est un défaut dont on a cessé d'entendre parler.
    const fautifs = configsVitest()
      .filter((f) => /^\s*retry\s*:/m.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(RACINE, f));
    expect(fautifs).toEqual([]);
  });
});
