/**
 * Garde — aucune ressource n'est chargée depuis un tiers.
 *
 * POURQUOI ELLE EXISTE. `src/index.css` importait les trois familles de
 * polices depuis Google Fonts. Deux conséquences, et la seconde est la vraie :
 * la politique de contenu du serveur devait ouvrir deux domaines tiers, et
 * l'adresse IP de CHAQUE visiteur partait chez Google à chaque chargement de
 * page — pour un produit dont l'argument est l'hébergement en France.
 *
 * Les fichiers sont désormais dans `public/fonts/`. Cette garde empêche le
 * retour d'une URL tierce, quelle qu'en soit la raison : la façon dont ça
 * revient, c'est un `@import` recopié d'une documentation, ou un `preconnect`
 * réintroduit « pour accélérer ». Rien n'échouerait ; la fuite serait
 * simplement de retour.
 *
 * Elle est la moitié CLIENTE d'une paire. L'autre est
 * `api-server/src/__tests__/entetes-securite.test.ts`, qui vérifie que la
 * politique de contenu n'autorise aucune origine tierce. Les deux doivent
 * tenir : une politique stricte devant un CSS qui appelle Google casserait
 * l'affichage, et un CSS propre derrière une politique laxiste laisserait la
 * porte ouverte au prochain import.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const RACINE = join(__dirname, "..", "..");
const CSS = readFileSync(join(RACINE, "src", "index.css"), "utf8");
const HTML = readFileSync(join(RACINE, "index.html"), "utf8");

describe("Les polices sont hébergées par nous", () => {
  test("index.css ne va CHERCHER aucune ressource distante", () => {
    // Les commentaires sont retirés : le nôtre EXPLIQUE le changement et cite
    // le fournisseur d'où l'on vient. Une garde qui interdirait d'en parler
    // pousserait à effacer la trace de la décision.
    const sansCommentaires = CSS.replace(/\/\*[^]*?\*\//g, "");

    // On vise les RÉCUPÉRATIONS, pas la chaîne « http ».
    //
    // Une première version interdisait toute occurrence de `https?://` et
    // tombait sur `xmlns='http://www.w3.org/2000/svg'`, à l'intérieur d'une
    // image `data:` en ligne. C'est un identifiant d'espace de noms XML :
    // aucun navigateur ne le déréférence, il ne part rien sur le réseau.
    // L'assertion était fausse, pas le fichier.
    expect(sansCommentaires).not.toMatch(/url\(\s*["']?https?:\/\//);
    expect(sansCommentaires).not.toMatch(/@import\s+["']https?:\/\//);
  });

  test("index.html n'ouvre plus de connexion vers un fournisseur de polices", () => {
    const sansCommentaires = HTML.replace(/<!--[^]*?-->/g, "");
    expect(sansCommentaires).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  test("les six fichiers déclarés existent vraiment", () => {
    // Un `@font-face` qui pointe sur un fichier absent ne casse rien de
    // visible : le navigateur retombe sur la police système, et l'interface
    // paraît seulement « un peu différente ». C'est le genre de panne qu'on
    // ne voit jamais parce qu'on ne la cherche pas.
    const declares = [...CSS.matchAll(/url\(\/fonts\/([^)]+)\)/g)].map((m) => m[1]);
    expect(declares.length).toBeGreaterThan(0);

    const presents = new Set(readdirSync(join(RACINE, "public", "fonts")));
    for (const fichier of declares) {
      expect(presents.has(fichier!), `police manquante : ${fichier}`).toBe(true);
    }
  });
});
