/**
 * Les tests passent par UN serveur partagé — ticket 4.22, lot 2.
 *
 * ── Ce que cette garde protège ────────────────────────────────────────────
 * `request(app)` fabrique un serveur HTTP NEUF à chaque appel : supertest
 * appelle `http.createServer(app)` dans son constructeur, l'écoute sur un port
 * éphémère, puis le referme. La suite en comptait plus de 28 000.
 *
 * Le port tout juste libéré est réattribué à un serveur suivant alors qu'un
 * paquet de l'ancienne connexion est encore en vol : la nouvelle connexion
 * reçoit un RST, et le client voit `read ECONNRESET`. C'est ce qui faisait
 * échouer la suite sur un fichier différent à chaque fois, jamais reproductible
 * en isolation.
 *
 * ── Pourquoi une garde STRUCTURELLE et pas une reproduction ───────────────
 * Le taux mesuré est d'environ 1 sur 8 000 requêtes. Un test qui exigerait de
 * VOIR un `ECONNRESET` serait lui-même flottant — on remplacerait un défaut
 * intermittent par un autre. La garde vérifie donc la propriété qui, elle, est
 * stable : aucun fichier ne recrée un serveur par requête.
 */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const DOSSIER = __dirname;

function fichiersDeTest(): string[] {
  return readdirSync(DOSSIER)
    .filter((f) => f.endsWith(".test.ts") && f !== "serveur-partage.test.ts")
    .map((f) => join(DOSSIER, f));
}

describe("aucun test ne recrée un serveur par requête", () => {
  const fichiers = fichiersDeTest();

  test("la garde lit bien quelque chose", () => {
    // Sans ça, une erreur de chemin rendrait cette garde silencieusement vraie.
    expect(fichiers.length).toBeGreaterThan(50);
  });

  test("plus aucun `request(app)`", () => {
    const fautifs = fichiers
      .filter((f) => /\brequest\(\s*app\s*\)/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(`${DOSSIER}/`, ""))
      .sort();

    expect(
      fautifs,
      `Ces fichiers ouvrent un serveur par requête — utiliser ` +
        `\`request(serveurTest(app))\` : ${fautifs.join(", ")}`,
    ).toEqual([]);
  });

  test("`http.createServer` n'apparaît dans aucun test", () => {
    // L'autre façon de recréer un serveur à la main, en contournant le helper.
    const fautifs = fichiers
      .filter((f) => /createServer\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(`${DOSSIER}/`, ""))
      .sort();

    expect(fautifs, `Serveur créé à la main dans : ${fautifs.join(", ")}`).toEqual([]);
  });
});

describe("le helper ne charge pas l'application lui-même", () => {
  test("`helpers.ts` n'importe pas `../app`", () => {
    // Plusieurs fichiers simulent un module (`vi.mock`) PUIS chargent l'app par
    // import différé, pour éprouver un chemin d'échec. Un import statique dans
    // helpers chargerait la vraie app avant eux : leur serveur ne verrait
    // jamais la simulation, et leurs tests passeraient au vert en n'éprouvant
    // plus rien.
    //
    // La première version de ce correctif faisait exactement ça, et trois
    // tests l'ont dit — `avoirs-incident` et `numero-brule` attendaient 500 et
    // recevaient 201.
    const src = readFileSync(join(DOSSIER, "helpers.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\.\/app/);
  });
});
