/**
 * Recherche d'entreprise via API Recherche Entreprises (gouvernementale).
 *
 * Règles :
 * - Appel serveur uniquement — aucune clé côté client.
 * - Cache 24 h en mémoire (Map), clé = paramètre de recherche normalisé.
 * - Gestion 429 : retourne { rateLimited: true } avec 200 pour que le front
 *   puisse afficher un message sans masquer le formulaire.
 * - Aucune donnée n'est écrite en base sans confirmation explicite du tenant.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";

const router: IRouter = Router();

// ── Cache 24 h ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { data: unknown; expiresAt: number }>();

function cacheGet(key: string): unknown | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return undefined; }
  return entry.data;
}
function cacheSet(key: string, data: unknown): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Schéma de résultat normalisé ─────────────────────────────────────────────

export interface EntrepriseResult {
  siret: string;
  siren: string;
  raisonSociale: string;
  formeJuridique: string;
  adresse: string;
  codePostal: string;
  commune: string;
  codeNaf: string;
  libelleNaf: string;
  trancheEffectif: string | null;
  dateCreation: string | null;
  etatAdministratif: string;
  tvaIntracom: string;
}

/**
 * Schéma Zod pour valider la structure réelle de l'API recherche-entreprises.api.gouv.fr v3/v4.
 * Toutes les valeurs sont coercées en string pour tolérer les variations de type
 * retournées par l'API (int, string, null) sans erreur.
 */
const SiegeSchema = z.object({
  siret: z.union([z.string(), z.number()]).transform(String).optional().default(""),
  adresse: z.string().optional().default(""),
  code_postal: z.string().optional().default(""),
  libelle_commune: z.string().optional().default(""),
  activite_principale: z.string().optional().default(""),
}).passthrough();

const GouvernementResultSchema = z.object({
  siren: z.union([z.string(), z.number()]).transform(String).optional().default(""),
  nom_complet: z.string().optional(),
  nom_raison_sociale: z.string().optional(),
  nature_juridique: z.string().optional().default(""),
  activite_principale: z.string().optional().default(""),
  date_creation: z.string().optional().nullable(),
  etat_administratif: z.string().optional().default("A"),
  tranche_effectif_salarie: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  tva: z.array(z.string()).optional().default([]),
  siege: SiegeSchema.optional().default({}),
}).passthrough();

/**
 * Normalise et valide un résultat de l'API recherche-entreprises.api.gouv.fr.
 * Retourne null si la structure ne correspond pas au schéma attendu.
 */
function normalizeResult(rawResult: unknown): EntrepriseResult | null {
  const parsed = GouvernementResultSchema.safeParse(rawResult);
  if (!parsed.success) return null;

  const result = parsed.data;
  const siege = result.siege ?? {};

  const nom = (result.nom_complet ?? result.nom_raison_sociale ?? "").trim();
  const tvaIntracom = result.tva?.[0] ?? "";

  return {
    siret: siege.siret ?? "",
    siren: result.siren,
    raisonSociale: nom,
    formeJuridique: result.nature_juridique ?? "",
    adresse: siege.adresse ?? "",
    codePostal: siege.code_postal ?? "",
    commune: siege.libelle_commune ?? "",
    codeNaf: result.activite_principale || siege.activite_principale || "",
    libelleNaf: "",  // pas fourni par l'API — rempli depuis lib/packs/naf-mapping côté front
    trancheEffectif: result.tranche_effectif_salarie ?? null,
    dateCreation: result.date_creation ?? null,
    etatAdministratif: result.etat_administratif ?? "A",
    tvaIntracom,
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

const SearchBody = z.object({
  q: z.string().trim().min(1).max(200),
});

router.post("/entreprises/recherche", async (req, res): Promise<void> => {
  const parsed = SearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Paramètre q manquant ou invalide" });
    return;
  }

  const q = parsed.data.q;
  const cacheKey = q.toLowerCase().replace(/\s+/g, " ");
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.json({ results: cached, fromCache: true });
    return;
  }

  try {
    const url = new URL("https://recherche-entreprises.api.gouv.fr/search");
    // Si la requête ressemble à un SIRET/SIREN (9 ou 14 chiffres), chercher par identifiant
    const cleaned = q.replace(/\s/g, "");
    if (/^\d{9}$/.test(cleaned)) {
      url.searchParams.set("q", cleaned);
      url.searchParams.set("per_page", "1");
    } else if (/^\d{14}$/.test(cleaned)) {
      url.searchParams.set("q", cleaned);
      url.searchParams.set("per_page", "1");
    } else {
      url.searchParams.set("q", q);
      url.searchParams.set("per_page", "10");
      url.searchParams.set("etat_administratif", "A"); // actifs seulement
    }

    const response = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 429) {
      res.json({ results: [], rateLimited: true });
      return;
    }
    if (!response.ok) {
      res.status(502).json({ error: "API gouvernementale indisponible" });
      return;
    }

    const data = await response.json() as { results?: unknown[] };
    const raw = Array.isArray(data.results) ? data.results : [];
    const results: EntrepriseResult[] = raw
      .map(e => normalizeResult(e))
      .filter((e): e is EntrepriseResult => e !== null && e.siret !== "");

    cacheSet(cacheKey, results);
    res.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur réseau";
    if (message.includes("timeout") || message.includes("abort")) {
      res.status(504).json({ error: "L'API gouvernementale ne répond pas" });
    } else {
      res.status(502).json({ error: "API gouvernementale indisponible" });
    }
  }
});

export default router;
