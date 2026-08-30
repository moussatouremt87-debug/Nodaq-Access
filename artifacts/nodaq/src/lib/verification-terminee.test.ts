/**
 * Une vérification réussie doit RAFRAÎCHIR l'état, pas seulement naviguer.
 *
 * ── CE QUI A ÉTÉ CONSTATÉ ───────────────────────────────────────────────────
 *
 * En production, le 30/08/2026 : le code à six chiffres était accepté, puis
 * l'écran le redemandait. Le second envoi rejouait un code déjà consommé —
 * « ce code n'est plus valable ». Personne ne pouvait entrer.
 *
 * La cause n'était pas le code. L'état d'authentification restait EN CACHE à
 * « code requis » : la navigation partait, la garde de route la renvoyait
 * aussitôt sur l'écran, et le parcours bouclait indéfiniment.
 *
 * `terminerVerification()` existait déjà et faisait les trois gestes
 * nécessaires — invalider, recharger, naviguer. Le nouveau chemin n'en avait
 * repris qu'un seul.
 *
 * ── POURQUOI UNE GARDE DE TEXTE, ET NON UN TEST DE RENDU ───────────────────
 *
 * Ce défaut ne se voit qu'après un aller-retour réseau, un cache de requêtes et
 * une redirection de garde — trois choses qu'un test de rendu simulerait, donc
 * qu'il ne prouverait pas. Ce qui se vérifie sûrement, en revanche, c'est
 * qu'aucun chemin de succès ne se contente de naviguer.
 *
 * Le jour où quelqu'un ajoutera un quatrième facteur, cette garde l'attendra.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const brut = readFileSync(join(__dirname, "..", "pages", "mfa.tsx"), "utf8");

/**
 * Les COMMENTAIRES sont retirés avant toute analyse.
 *
 * Première version de cette garde : elle est restée verte alors que l'appel
 * avait été retiré — parce que le commentaire qui EXPLIQUE le correctif cite
 * `terminerVerification()` trois fois. La garde se prouvait elle-même.
 *
 * Le dépôt porte déjà cette cicatrice ailleurs : une consigne d'agent avait
 * été contredite par le commentaire posé juste à côté d'elle, dans la même
 * chaîne. Un test qui lit du source doit lire le CODE, jamais la prose.
 */
const source = brut
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

/** Les corps de fonction qui traitent une soumission de second facteur. */
function corpsDesSoumissions(): { nom: string; corps: string }[] {
  const trouves: { nom: string; corps: string }[] = [];
  const re = /async function (soumettre\w+)\s*\([^)]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // On lit jusqu'à la prochaine déclaration de fonction — grossier mais
    // suffisant, et surtout lisible par qui débarque sur un échec.
    const suite = source.slice(m.index);
    const fin = suite.slice(1).search(/\n  (async function|function) /);
    trouves.push({ nom: m[1]!, corps: fin === -1 ? suite : suite.slice(0, fin) });
  }
  return trouves;
}

describe("tout chemin de second facteur passe par terminerVerification", () => {
  test("il existe bien des chemins à vérifier — sinon cette garde est creuse", () => {
    const noms = corpsDesSoumissions().map(f => f.nom);
    expect(noms.length).toBeGreaterThanOrEqual(2);
    expect(noms).toContain("soumettreCodeCourriel");
  });

  test("aucun ne se contente de naviguer", () => {
    for (const { nom, corps } of corpsDesSoumissions()) {
      const navigueSeul =
        /setLocation\(/.test(corps) && !/terminerVerification\(/.test(corps);
      expect(
        navigueSeul,
        `${nom} navigue sans rafraîchir l'état : la garde de route renverra ` +
          `l'utilisateur sur cet écran, et son code sera déjà consommé.`,
      ).toBe(false);
    }
  });

  test("la routine partagée fait bien les TROIS gestes", () => {
    const bloc = /async function terminerVerification\(\)\s*\{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(bloc, "terminerVerification introuvable").not.toBe("");
    // Naviguer sans invalider ramène au point de départ ; invalider sans
    // recharger laisse la garde décider sur un état encore vide.
    expect(bloc).toMatch(/invalidateQueries/);
    expect(bloc).toMatch(/refetchAuth\(\)/);
    expect(bloc).toMatch(/setLocation\(/);
  });
});

/**
 * ── LA SORTIE DOIT VRAIMENT SORTIR ──────────────────────────────────────────
 *
 * Constaté le 30/08/2026 : l'écran proposait « recommencer avec une autre
 * adresse » par un simple lien vers /login. La session restait ouverte, la
 * garde de route ramenait aussitôt sur cet écran — et l'application s'ouvrait
 * même directement ici à chaque visite.
 *
 * Quelqu'un qui s'est trompé d'adresse n'avait alors AUCUN moyen de repartir :
 * les codes continuaient de partir au mauvais endroit, quel que soit le nombre
 * de renvois. Une sortie qui ne sort pas est pire qu'une absence de sortie,
 * parce qu'elle fait perdre du temps avant de comprendre.
 */
describe("l'écran de code offre une vraie sortie", () => {
  test("elle ferme la session AVANT de naviguer", () => {
    const bloc = /async function changerDeCompte\(\)\s*\{[\s\S]*?\n  \}/.exec(source)?.[0] ?? "";
    expect(bloc, "changerDeCompte introuvable").not.toBe("");
    expect(bloc, "sans déconnexion, la garde ramène sur cet écran").toMatch(/auth\/logout/);
    expect(bloc).toMatch(/setLocation\(/);
    // L'ordre compte : naviguer avant de fermer laisse la garde décider sur
    // une session encore valide.
    expect(bloc.indexOf("logout")).toBeLessThan(bloc.indexOf("setLocation"));
  });

  test("aucune sortie ne se contente d'un lien vers /login", () => {
    // Un <a href="/login"> ne ferme rien : c'est la forme exacte du défaut.
    expect(source).not.toMatch(/href=["\']\/login["\']/);
  });
});
