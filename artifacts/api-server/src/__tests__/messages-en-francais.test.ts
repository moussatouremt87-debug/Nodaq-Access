/**
 * Garde : ce que l'utilisateur LIT est en français.
 *
 * ── POURQUOI ELLE EXISTE ────────────────────────────────────────────────────
 *
 * Le produit s'adresse à un artisan. Une trentaine de messages d'erreur lui
 * répondaient « Not found », « Invalid input », « Authentication required » —
 * dont l'inscription et la vérification du second facteur, c'est-à-dire les
 * deux premiers écrans qu'un nouvel utilisateur rencontre.
 *
 * Aucun test ne s'en apercevait : un message anglais est un message valide, la
 * requête réussit ou échoue exactement pareil. Seul un humain qui lit l'écran
 * le voit — et il conclut que le logiciel n'est pas fini.
 *
 * ── LE DÉTECTEUR CHERCHE L'ANGLAIS, PAS L'ABSENCE DE FRANÇAIS ───────────────
 *
 * Première version : accepter une chaîne portant une « marque de français »
 * (accent ou mot-outil). Elle a signalé quatre messages parfaitement français
 * — « PDF non disponible », « Bloc inconnu », « Format attendu : YYYY-MM-DD »,
 * « Factur-X audit bloquant. » — parce qu'aucun de leurs mots ne figurait dans
 * ma liste. Une garde qui crie faux quatre fois sur cinq finit désactivée.
 *
 * Le sens est donc inversé : on cherche les mots ANGLAIS. Le français n'a plus
 * à se justifier, et la liste des marqueurs couvre le vocabulaire réel des
 * messages d'erreur. C'est aussi le bon compromis de risque : un faux négatif
 * laisse passer une phrase, un faux positif ferait retirer la garde entière.
 */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("..", import.meta.url).pathname;

/**
 * Les valeurs de `error` qui sont des CODES lus par l'écran, pas des phrases.
 *
 * `mfa_required` est accompagné d'un `mfaStatus` structuré et vérifié par nom
 * dans `mfa-auth.test.ts` : le traduire casserait un contrat sans rien gagner,
 * puisque l'écran ne l'affiche jamais tel quel.
 */
const CODES_MACHINE = new Set(["mfa_required"]);

/** Vocabulaire anglais des messages d'erreur. */
const MOTS_ANGLAIS = new RegExp(
  "\\b(not|found|invalid|input|required|must|should|does|doesn't|cannot|can't|" +
  "unable|failed|failure|missing|unknown|unauthorized|forbidden|denied|" +
  "allowed|please|try|again|expected|received|reference|known|team|the|this|" +
  "your|there|already|exists|access|request|response|server|internal|" +
  "bad|wrong|only|first|run|set|get|check)\\b",
  "i",
);

/** Les chaînes rendues au client dans un champ `error`. */
function messagesUtilisateur(source: string): string[] {
  const sansCommentaires = source
    // Les commentaires de ce dépôt sont en français ET citent des exemples
    // anglais. Les analyser produirait des faux positifs — et, dans l'autre
    // sens, un commentaire français ferait passer pour bon un message anglais
    // voisin. C'est exactement la garde creuse rencontrée ce matin.
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  // `[^"\n]` et non `[^"]` : sans l'exclusion du saut de ligne, la recherche
  // traversait un `console.error("…", err)` sur plusieurs lignes et rendait
  // un fragment de code (« , err); ») comme s'il s'agissait d'un message.
  return [...sansCommentaires.matchAll(/\berror:\s*"([^"\n]{4,})"/g)].map((m) => m[1]!);
}

function fichiersSource(dossier: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom === "__tests__") continue;
      out.push(...fichiersSource(chemin));
    } else if (nom.endsWith(".ts")) {
      out.push(chemin);
    }
  }
  return out;
}

function messagesFautifs(): string[] {
  const fautifs: string[] = [];
  for (const chemin of [
    ...fichiersSource(join(SRC, "routes")),
    ...fichiersSource(join(SRC, "middleware")),
  ]) {
    for (const msg of messagesUtilisateur(readFileSync(chemin, "utf8"))) {
      if (CODES_MACHINE.has(msg)) continue;
      if (MOTS_ANGLAIS.test(msg)) fautifs.push(`${chemin.replace(SRC, "")} → « ${msg} »`);
    }
  }
  return fautifs.sort();
}

describe("les messages d'erreur sont écrits en français", () => {
  test("aucune route ni middleware ne répond en anglais", () => {
    const fautifs = messagesFautifs();
    expect(
      fautifs,
      "Ces messages sont lus par un artisan, pas par un développeur " +
        "(règle 3 bis b). Écrivez-les en français, ou — s'il s'agit d'un code " +
        "lu par l'écran — inscrivez-le dans CODES_MACHINE avec sa raison.\n" +
        fautifs.join("\n"),
    ).toEqual([]);
  });

  test("le détecteur voit vraiment l'anglais — sinon il ne garde rien", () => {
    /*
     * Une garde qu'on n'a jamais vue se déclencher n'est pas une garde
     * (règle 7). Ces formulations sont celles qui viennent d'être retirées du
     * code, mot pour mot.
     */
    for (const anglais of [
      "Not found", "Invalid input", "Authentication required",
      "Action not found", "membreId does not reference a known team member",
      "Session manquante — requireAuth must run first.",
    ]) {
      expect(MOTS_ANGLAIS.test(anglais), `« ${anglais} » n'est pas vu comme anglais`).toBe(true);
    }
  });

  test("il ne crie pas sur du français — même sans accent", () => {
    /*
     * Le vrai danger d'une garde de langue est le faux positif : quatre
     * messages français signalés à tort, et quelqu'un la retire. Ces six-là
     * sont des messages RÉELS du dépôt, dont les quatre qu'une première
     * version signalait par erreur.
     */
    for (const francais of [
      "Code incorrect.", "Identifiant manquant", "Affaire introuvable.",
      "PDF non disponible", "Bloc inconnu", "Format attendu : YYYY-MM-DD",
      "Factur-X audit bloquant.", "Un compte avec cet email existe deja.",
    ]) {
      expect(MOTS_ANGLAIS.test(francais), `« ${francais} » pris pour de l'anglais`).toBe(false);
    }
  });

  test("les commentaires ne peuvent pas blanchir un message", () => {
    // Ce matin, une garde est restée verte sous injection parce que MON
    // commentaire contenait les mots qu'elle cherchait. Le retrait des
    // commentaires est donc vérifié, pas supposé.
    const piege = "// Un commentaire français, avec des accents et tout.\n"
      + 'res.status(404).json({ error: "Not found" });';
    expect(messagesUtilisateur(piege)).toEqual(["Not found"]);
  });

  test("un message sur plusieurs lignes n'est pas confondu avec du code", () => {
    // `console.error("[x] échec:", err)` suivi d'un `error:` faisait rendre
    // « , err); » comme un message. Un faux positif que personne ne sait
    // corriger est une garde qu'on finit par ignorer.
    const source = 'console.error("[avoirs] échec:", err);\n'
      + 'res.status(500).json({ error: "Génération impossible." });';
    expect(messagesUtilisateur(source)).toEqual(["Génération impossible."]);
  });
});
