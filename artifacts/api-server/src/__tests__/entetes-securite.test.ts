/**
 * Les en-têtes de sécurité HTTP.
 *
 * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────────
 * L'application n'en posait AUCUN. Le mot `helmet` n'apparaissait nulle part
 * dans le dépôt, et une réponse du déploiement ne portait ni
 * `Strict-Transport-Security`, ni `X-Content-Type-Options`, ni politique de
 * contenu. L'application restait encadrable dans une iframe tierce.
 *
 * ── CE QUE CES TESTS PROTÈGENT, ET DANS QUEL ORDRE ────────────────────────
 * D'abord la présence — c'est la garde du défaut. Ensuite deux pièges que la
 * présence seule ne couvre pas :
 *
 *   — HSTS posé sur un déploiement en HTTP ÉPINGLE le domaine dans le
 *     navigateur, qui refusera ensuite toute connexion non chiffrée. La panne
 *     survit à la correction du serveur : elle est dans le navigateur de
 *     l'utilisateur, qui ne sait pas la retirer.
 *
 *   — Une CSP qui oublie l'empreinte du script en ligne d'`index.html` fait
 *     revenir le clignotement de thème à chaque chargement. L'empreinte est
 *     donc calculée depuis le fichier, jamais écrite en dur.
 *
 * Les en-têtes sont vérifiés sur une réponse d'ERREUR autant que sur une
 * réussie : un en-tête qui ne protège que le chemin nominal ne protège rien.
 */
import { describe, test, expect, afterEach } from "vitest";
import request from "supertest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import app from "../app.js";
import { serveurTest } from "./helpers.js";
import {
  empreintesScriptsEnLigne,
  politiqueContenu,
  deploiementChiffre,
} from "../lib/entetes-securite.js";

const PUBLIC_URL_INITIAL = process.env["PUBLIC_URL"];

afterEach(() => {
  if (PUBLIC_URL_INITIAL === undefined) delete process.env["PUBLIC_URL"];
  else process.env["PUBLIC_URL"] = PUBLIC_URL_INITIAL;
});

/** Écrit un `index.html` jetable et rend son chemin. */
function indexJetable(contenu: string): string {
  const dossier = mkdtempSync(join(tmpdir(), "nodaq-csp-"));
  const chemin = join(dossier, "index.html");
  writeFileSync(chemin, contenu, "utf8");
  return chemin;
}

describe("Les en-têtes sont posés sur toute réponse", () => {
  test("une route qui répond 401 les porte aussi", async () => {
    // Route authentifiée, sans cookie : le middleware d'authentification
    // répond avant tout traitement métier. C'est exactement le chemin où un
    // en-tête posé trop tard serait absent.
    const res = await request(serveurTest(app)).get("/api/auth/me").expect(401);

    expect(res.headers["content-security-policy"]).toBeTruthy();
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("la page ne peut pas être encadrée par un tiers", async () => {
    const res = await request(serveurTest(app)).get("/api/health").expect(200);
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});

describe("HSTS suit le protocole réel du déploiement", () => {
  test("posé quand PUBLIC_URL est en HTTPS", () => {
    process.env["PUBLIC_URL"] = "https://app.nodaq.fr";
    expect(deploiementChiffre()).toBe(true);
  });

  test("ABSENT en HTTP — sinon le navigateur épingle et la panne lui survit", () => {
    process.env["PUBLIC_URL"] = "http://192.168.1.20:8080";
    expect(deploiementChiffre()).toBe(false);
  });

  test("absent aussi quand PUBLIC_URL n'est pas définie", () => {
    delete process.env["PUBLIC_URL"];
    expect(deploiementChiffre()).toBe(false);
  });
});

describe("La politique de contenu autorise le script en ligne par son empreinte", () => {
  test("l'empreinte est calculée depuis le fichier servi", () => {
    const chemin = indexJetable(
      `<html><head><script>var t = 1;</script></head><body></body></html>`,
    );
    const empreintes = empreintesScriptsEnLigne(chemin);
    expect(empreintes).toHaveLength(1);
    expect(empreintes[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
  });

  test("un script CHANGÉ donne une empreinte différente", () => {
    // C'est ce qui interdit d'écrire l'empreinte en dur : la recopier ferait
    // revenir le clignotement à la première retouche du script.
    const a = empreintesScriptsEnLigne(indexJetable("<script>var t = 1;</script>"));
    const b = empreintesScriptsEnLigne(indexJetable("<script>var t = 2;</script>"));
    expect(a[0]).not.toBe(b[0]);
  });

  test("un script EXTERNE n'est pas empreinté — il relève de 'self'", () => {
    const chemin = indexJetable(`<script type="module" src="/src/main.tsx"></script>`);
    expect(empreintesScriptsEnLigne(chemin)).toHaveLength(0);
  });

  test("fichier absent : aucune empreinte, et rien ne casse", () => {
    // En développement, c'est Vite qui sert la page, pas cette application.
    expect(empreintesScriptsEnLigne("/chemin/qui/n/existe/pas.html")).toEqual([]);
  });

  test("le VRAI index.html du dépôt rend exactement une empreinte", () => {
    // Les tests ci-dessus travaillent sur des fichiers synthétiques : ils
    // prouvent l'extraction, pas qu'elle marche sur NOTRE page. Celui-ci lit
    // le fichier réel.
    //
    // Il porte sur la SOURCE et non sur la construction, et ce n'est pas un
    // pis-aller : vérifié à la main, Vite recopie ce script sans le
    // transformer — les deux empreintes sont identiques au bit près. Garder
    // contre `dist/` exigerait une construction préalable, donc un test qui
    // se sauterait quand elle manque. Un test qui se saute ne protège rien.
    const source = join(__dirname, "..", "..", "..", "nodaq", "index.html");
    const empreintes = empreintesScriptsEnLigne(source);

    // UNE seule, et c'est le fond de l'affaire : un second script en ligne
    // ajouté à la page serait empreinté lui aussi, mais ce test le signale —
    // c'est l'occasion de se demander s'il a sa place là plutôt que dans un
    // module.
    expect(empreintes).toHaveLength(1);
    expect(empreintes[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
  });

  test("la politique refuse les scripts en ligne NON empreintés", () => {
    const csp = politiqueContenu(["'sha256-abc='"]);
    expect(csp).toContain("script-src 'self' 'sha256-abc='");
    // La concession sur les styles est assumée (Tailwind, framer-motion) ;
    // celle sur les scripts ne l'est pas, et ce test l'interdit.
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});
