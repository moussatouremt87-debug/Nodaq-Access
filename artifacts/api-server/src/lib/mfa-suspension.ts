/**
 * Suspension du second facteur — décision fondateur du 2026-08-21, le temps
 * que le produit ne soit pas en ligne.
 *
 * ── Pourquoi une bascule plutôt qu'un retrait ─────────────────────────────
 * Retirer `requireMfaVerified` des routes aurait « marché » aussi, et personne
 * ne l'aurait remis : un garde-fou décâblé se rétablit à la main, et la main
 * oublie. Ici la protection reste posée partout où elle l'était ; ce qui
 * change est une condition, nommée, qu'on retire en effaçant une ligne du
 * `.env`.
 *
 * ── Pourquoi elle est INERTE en production ────────────────────────────────
 * La variable ne suffit pas : `NODE_ENV=production` reprend le dessus, quoi
 * qu'elle vaille. Une bascule capable d'éteindre l'authentification forte en
 * production serait exactement l'interrupteur qu'on finit par trouver actif
 * sur le serveur qui compte — par une copie de `.env`, un modèle recopié, un
 * `docker-compose` repris d'ailleurs.
 *
 * ── Un seul endroit, lu par DEUX appelants ────────────────────────────────
 * `requireMfaVerified` (qui bloque les routes) et `/auth/me` (qui dit à
 * l'écran s'il doit rediriger vers l'enrôlement). Deux conditions séparées
 * auraient divergé, et le résultat serait le pire des deux mondes : un écran
 * qui exige un second facteur que le serveur n'attend plus.
 */
export function secondFacteurSuspendu(): boolean {
  if (process.env["NODE_ENV"] === "production") return false;
  return process.env["MFA_SUSPENDU_HORS_PRODUCTION"] === "true";
}
