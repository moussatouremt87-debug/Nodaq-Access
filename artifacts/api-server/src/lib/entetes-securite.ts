/**
 * Les en-têtes de sécurité HTTP.
 *
 * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────────
 * L'application n'en posait AUCUN. Ni `Strict-Transport-Security`, ni
 * `X-Content-Type-Options`, ni politique de contenu — vérifié sur le
 * déploiement et dans le dépôt, où le mot `helmet` n'apparaissait nulle part.
 * Ce n'était pas un défaut de configuration : c'était une absence de départ.
 * L'application restait encadrable dans une iframe tierce.
 *
 * ── POURQUOI PAS `helmet` ─────────────────────────────────────────────────
 * Le dépôt écrit ses propres clients partout où un SDK serait tentant (LLM,
 * téléphonie, banque) — ce sont trente lignes qu'on lit, contre une
 * dépendance qu'on subit. Et toute modification d'un `package.json` demande
 * ici `pnpm install --lockfile-only` puis `--frozen-lockfile`, faute de quoi
 * seule la CI casse, après la fusion.
 *
 * ── LE PIÈGE DE HSTS ──────────────────────────────────────────────────────
 * `Strict-Transport-Security` n'est posé que si `PUBLIC_URL` est en HTTPS.
 * C'est le MÊME signal que celui du cookie de session (`routes/auth.ts`), et
 * pour la même raison : envoyé depuis un déploiement en HTTP simple — le
 * portable de l'artisan sur le Wi-Fi de l'atelier, une IP de réseau local —
 * l'en-tête ÉPINGLE le domaine dans le navigateur, qui refusera ensuite toute
 * connexion non chiffrée. La panne survit à la correction du serveur : elle
 * est dans le navigateur, et l'utilisateur ne sait pas la retirer.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Les empreintes des scripts EN LIGNE de la page servie.
 *
 * `index.html` en porte un — celui qui applique le thème avant le premier
 * rendu, pour éviter que l'écran ne bascule visiblement à chaque chargement.
 * Une CSP en `script-src 'self'` le bloquerait, et le clignotement
 * reviendrait.
 *
 * L'empreinte est CALCULÉE depuis le fichier réellement servi, jamais écrite
 * en dur : une constante recopiée à la main deviendrait fausse à la première
 * retouche du script, et la panne serait un clignotement — visible, mais que
 * personne ne rattacherait à une politique de contenu.
 *
 * Rendue vide quand le fichier n'existe pas : en développement, c'est Vite
 * qui sert la page, pas cette application.
 */
export function empreintesScriptsEnLigne(cheminIndex: string): string[] {
  let html: string;
  try {
    html = readFileSync(cheminIndex, "utf8");
  } catch {
    return [];
  }
  const empreintes: string[] = [];
  // `[^]` et non `.` : le script tient sur plusieurs lignes.
  for (const found of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([^]*?)<\/script>/g)) {
    const contenu = found[1];
    if (contenu === undefined || contenu.trim() === "") continue;
    empreintes.push(`'sha256-${createHash("sha256").update(contenu, "utf8").digest("base64")}'`);
  }
  return empreintes;
}

/**
 * Construit la politique de contenu.
 *
 * `style-src` accepte `'unsafe-inline'`, et il faut le dire plutôt que le
 * laisser passer pour un oubli : Tailwind et framer-motion posent des styles
 * en ligne sur les éléments qu'ils animent. Les interdire figerait toutes les
 * transitions de l'interface. Le risque résiduel d'une injection de STYLE est
 * sans commune mesure avec celui d'une injection de SCRIPT, que
 * `script-src` bloque, lui, sans concession.
 *
 * AUCUN domaine tiers n'y figure, et c'est le point. Les polices sont
 * hébergées dans `public/fonts/` : rien, dans cette application, ne va
 * chercher une ressource ailleurs. Toute future entrée ici doit se justifier
 * autrement que par « la bibliothèque le demande » — une origine ouverte dans
 * `script-src` ou `font-src` est une adresse IP d'utilisateur envoyée à un
 * tiers à chaque chargement de page.
 */
export function politiqueContenu(empreintes: string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${empreintes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    // `data:` pour les logos encodés dans les PDF et les aperçus ; `blob:`
    // pour les documents engendrés côté navigateur avant téléchargement.
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    // `'none'` et pas `'self'` : rien, dans ce produit, ne s'encadre soi-même.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Le déploiement est-il servi en HTTPS ? Même signal que le cookie de session. */
export function deploiementChiffre(): boolean {
  return (process.env["PUBLIC_URL"] ?? "").startsWith("https://");
}

export function entetesSecurite(cheminIndex: string): RequestHandler {
  // Calculé UNE FOIS au démarrage : relire le fichier à chaque requête
  // coûterait un accès disque par appel d'API pour une valeur qui ne bouge
  // pas entre deux déploiements.
  const csp = politiqueContenu(empreintesScriptsEnLigne(cheminIndex));
  const chiffre = deploiementChiffre();

  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("Content-Security-Policy", csp);
    // Doublon volontaire de `frame-ancestors` pour les navigateurs anciens,
    // qui ignorent la CSP mais comprennent celui-ci.
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // L'origine seule vers un tiers : une URL de facture porte un identifiant.
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    // Aucune de ces interfaces n'est utilisée côté serveur ; le micro est
    // demandé par le navigateur pour la dictée, donc laissé à `self`.
    res.setHeader(
      "Permissions-Policy",
      "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
    );
    if (chiffre) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}
