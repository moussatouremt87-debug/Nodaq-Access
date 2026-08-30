import type { OAuthProvider } from "./connecteurs-oauth.js";

function normaliserOrigine(raw: string, variable: "APP_URL" | "PUBLIC_URL"): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${variable} must be an absolute http(s) origin.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== ""
    || url.password !== ""
    || (url.pathname !== "" && url.pathname !== "/")
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error(`${variable} must contain only scheme and host (no credentials, path, query or fragment).`);
  }
  const hoteLocal = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
    || /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
  // NODE_ENV vaut aussi production quand le SPA construit est servi sur le
  // réseau local. HTTP y reste nécessaire (pas de certificat pour une IP
  // privée), mais il est refusé pour toute origine publiquement routable.
  if (process.env["NODE_ENV"] === "production" && url.protocol !== "https:" && !hoteLocal) {
    throw new Error(`${variable} must use https in production.`);
  }
  return url.origin;
}

export function verifierOriginesDemarrage(): void {
  const appUrl = process.env["APP_URL"];
  const publicUrl = process.env["PUBLIC_URL"];
  if (appUrl) normaliserOrigine(appUrl, "APP_URL");
  if (publicUrl) normaliserOrigine(publicUrl, "PUBLIC_URL");
}

export function oauthCallbackUrl(provider: OAuthProvider): string {
  // Le callback doit revenir sur l'hôte qui a posé le cookie de session
  // host-only. PUBLIC_URL est déjà l'origine canonique de CORS et des cookies.
  const publicUrl = process.env["PUBLIC_URL"];
  const origin = publicUrl
    ? normaliserOrigine(publicUrl, "PUBLIC_URL")
    : normaliserOrigine(process.env["APP_URL"] ?? "https://nodaq.fr", "APP_URL");
  return new URL(`/api/connecteurs/${provider}/retour`, `${origin}/`).toString();
}

/** Même signal pour tous les cookies : l'origine publique réellement servie. */
export function cookieDoitEtreSecurise(): boolean {
  const raw = process.env["PUBLIC_URL"];
  if (!raw) return false;
  try {
    return normaliserOrigine(raw, "PUBLIC_URL").startsWith("https://");
  } catch {
    // Le démarrage refusera cette configuration ; l'import d'un module de
    // route ne doit toutefois jamais transformer une erreur en cookie Secure.
    return false;
  }
}
