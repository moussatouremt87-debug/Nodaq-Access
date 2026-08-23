/*
 * Aucune formule interdite ne sort du produit lui-même — ticket 4.23.
 *
 * ── Ce que ce fichier peut prouver, et ce qu'il ne peut pas ───────────────
 * Il ne juge PAS ce que le modèle répond : en CI le modèle est simulé, et une
 * éval qui noterait des réponses simulées mesurerait la simulation. Cette
 * partie vit dans `scripts/evals-agent.mjs`, hors CI, sur `LLM_BASE_URL`.
 *
 * Il prouve trois choses que la CI PEUT tenir, sans clé et sans modèle :
 *
 *   1. Le prompt système INTERDIT explicitement les formules du 22/08, et
 *      nomme celle qui les remplace.
 *   2. Aucune réponse écrite EN DUR dans le produit — message d'erreur, repli,
 *      texte de garde — ne contient une formule interdite. C'est la moitié du
 *      défaut que le modèle ne porte pas : un repli codé « je ne peux pas
 *      créer de facture » sortirait sans qu'aucun modèle soit en cause.
 *   3. Chaque outil que le corpus attend existe RÉELLEMENT côté agent. Un
 *      corpus qui viserait un outil disparu échouerait pour la mauvaise
 *      raison, et on croirait à une régression de comportement.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  formulesInterdites, CORPUS_EVAL, FORMULE_CAPACITE_ABSENTE,
} from "@nodaq/shared";


const RACINE = new URL("../", import.meta.url).pathname;

describe("le prompt système porte l'interdiction", () => {
  // Le prompt est un littéral dans `buildSystemPrompt`, qui n'est pas exportée
  // et lit la base. On lit donc la SOURCE plutôt que d'exporter une fonction
  // pour les seuls besoins d'un test — le texte est le même, et le test ne
  // fabrique pas un tenant pour vérifier une chaîne.
  const source = readFileSync(join(RACINE, "lib", "mistralAgent.ts"), "utf8");

  test("il nomme les trois refus prohibés", () => {
    expect(source).toContain("OPÉRATEUR");
    expect(source.toLowerCase()).toContain("je ne peux pas créer de factures");
    expect(source.toLowerCase()).toContain("logiciel de comptabilité");
    expect(source.toLowerCase()).toContain("expert-comptable");
  });

  test("la formule de remplacement du prompt est celle du corpus", () => {
    // Deux formulations pour la même promesse dériveraient : l'éval jugerait
    // l'une pendant que le prompt enseigne l'autre.
    const noyau = FORMULE_CAPACITE_ABSENTE.replace(/^Ce n'est /, "").replace(/\.$/, "");
    expect(source).toContain(noyau);
  });
});

describe("aucune réponse EN DUR du produit ne contient une formule interdite", () => {
  /** Les fichiers source du serveur, hors tests. */
  function sources(dir: string): string[] {
    let out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const chemin = join(dir, e.name);
      if (e.isDirectory()) {
        if (["node_modules", "dist", "__tests__"].includes(e.name)) continue;
        out = out.concat(sources(chemin));
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
        out.push(chemin);
      }
    }
    return out;
  }

  test("les messages du serveur sont propres", () => {
    // Le prompt système est exclu : il CITE les formules pour les interdire,
    // précédées d'une croix. Les inclure ferait échouer la garde sur le texte
    // même qui les proscrit.
    const fautifs: string[] = [];
    for (const chemin of sources(RACINE)) {
      if (chemin.endsWith("mistralAgent.ts")) continue;
      // ── Ligne par ligne, et non sur le fichier entier ──────────────────
      // La première version extrayait les chaînes du fichier d'un seul tenant.
      // Elle ne trouvait RIEN : une apostrophe dans un commentaire français —
      // il y en a partout ici — décale l'appariement des guillemets, et tout
      // ce qui suit tombe à côté. Éprouvé : une réponse interdite injectée
      // dans `routes/factures.ts` passait inaperçue.
      //
      // La parité des guillemets tient à l'échelle d'une LIGNE.
      for (const ligne of readFileSync(chemin, "utf8").split("\n")) {
        const nu = ligne.trim();
        // Un commentaire ne sort jamais vers l'utilisateur — et ce dépôt en
        // écrit beaucoup, qui citent les formules pour les proscrire.
        if (nu.startsWith("//") || nu.startsWith("*") || nu.startsWith("/*")) continue;
        for (const m of ligne.matchAll(/"([^"]{20,400})"|`([^`]{20,400})`/g)) {
          const texte = (m[1] ?? m[2] ?? "").replace(/\\n/g, " ");
          for (const f of formulesInterdites(texte)) {
            fautifs.push(`${chemin.split("/src/")[1]} — ${f.code} : « ${texte.slice(0, 90)}… »`);
          }
        }
      }
    }
    expect(
      fautifs,
      `réponses en dur contenant une formule interdite :\n  ${fautifs.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("le corpus vise des outils qui existent", () => {
  test("chaque outil attendu est déclaré à l'agent", () => {
    // Sans cette garde, renommer un outil ferait échouer l'éval comme un
    // défaut de COMPORTEMENT, alors que c'est un défaut de corpus. On perdrait
    // des heures à chercher au mauvais endroit — c'est exactement ce qui vient
    // de se produire sur le rouge d'Auckland.
    const source = readFileSync(join(RACINE, "lib", "mistralAgent.ts"), "utf8");
    const declares = new Set(
      [...source.matchAll(/^\s+name: "([a-z_]+)"/gm)].map((m) => m[1]!),
    );
    // Aucune exemption. La première version de ce test en portait une pour
    // `creer_devis` / `creer_facture` — c'était un pansement sur une erreur du
    // corpus, qui visait les noms d'intention VOCALE (français) au lieu des
    // noms d'outil de l'agent (anglais). Exempter, c'est éteindre la garde
    // pour la faire passer.
    const absents = [...new Set(
      CORPUS_EVAL.map((c) => c.outilAttendu).filter((o): o is string => o !== null),
    )].filter((o) => !declares.has(o));

    expect(
      absents,
      `outils attendus par le corpus mais non déclarés : ${absents.join(", ")}\n`
      + `→ soit l'outil a été renommé, soit le corpus vise à côté.`,
    ).toEqual([]);
  });
});
