/**
 * Interrogation du RNIC — syndics de copropriété.
 *
 * ── UN SYNDIC BÉNÉVOLE EST UN PARTICULIER ────────────────────────────────────
 * Le registre distingue syndic PROFESSIONNEL (une société — Foncia, Citya…),
 * BÉNÉVOLE (un résident, donc une personne PHYSIQUE) et COOPÉRATIF. Seul le
 * premier est une cible professionnelle légitime. `estSyndicProfessionnel`
 * applique la même doctrine que `estPersonneMorale` dans
 * `annuaire-entreprises.ts` : dans le doute, on écarte.
 *
 * ── DEUX INCONNUES DE SCHÉMA ──────────────────────────────────────────────────
 * Ni le mécanisme d'accès requêtable exact, ni le nom du champ « type de
 * syndic » n'ont pu être confrontés à un accès réel au moment de l'écriture
 * de ce module — contrairement à BOAMP et DECP, confirmés ce soir. Le schéma
 * accepte plusieurs noms de champs plausibles et REFUSE bruyamment le reste.
 *
 * ── LE TRANSPORT EST INJECTÉ ────────────────────────────────────────────────
 * Aucun test n'atteint le réseau.
 */
import { z } from "zod";
import type { SourcePublique } from "@nodaq/shared";

export class RnicConfigError extends Error {
  constructor(
    message: string,
    readonly variableManquante: string,
  ) {
    super(message);
    this.name = "RnicConfigError";
  }
}

export class RnicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RnicError";
  }
}

export type TransportRnic = (
  url: string,
) => Promise<{ status: number; texte: string }>;

const transportParDefaut: TransportRnic = async (url) => {
  const r = await fetch(url);
  return { status: r.status, texte: await r.text() };
};

export interface ConfigRnic {
  readonly baseUrl: string;
  readonly source: SourcePublique;
}

/** Lit la configuration. Lève `RnicConfigError` quand elle manque. */
export function configRnic(): ConfigRnic {
  const baseUrl = process.env["RNIC_BASE_URL"]?.trim();
  if (!baseUrl) {
    throw new RnicConfigError(
      "RNIC_BASE_URL n'est pas configurée : aucun syndic ne peut être justifié.",
      "RNIC_BASE_URL",
    );
  }
  const label = process.env["RNIC_SOURCE_LABEL"]?.trim();
  const url = process.env["RNIC_SOURCE_URL"]?.trim();
  if (!label || !url) {
    throw new RnicConfigError(
      "RNIC_SOURCE_LABEL et RNIC_SOURCE_URL doivent être définies : " +
        "un syndic sans source citable ne s'affiche pas.",
      label ? "RNIC_SOURCE_URL" : "RNIC_SOURCE_LABEL",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), source: { label, url } };
}

// ── La réponse RNIC ──────────────────────────────────────────────────────────

const Coproprietaire = z.object({
  commune: z.string().optional(),
  code_postal: z.string().optional(),
  nom_syndic: z.string().min(1).optional(),
  syndic_nom: z.string().min(1).optional(),
  denomination_syndic: z.string().min(1).optional(),
  /** Marqueurs candidats — noms non confirmés. */
  type_syndic: z.string().optional(),
  syndic_type: z.string().optional(),
  nature_syndic: z.string().optional(),
});

const ReponseRnic = z.union([
  z.object({ results: z.array(Coproprietaire) }),
  z.object({ data: z.array(Coproprietaire) }),
]);

export interface SyndicPublique {
  readonly commune: string | null;
  readonly codePostal: string | null;
  readonly nomSyndic: string | null;
  readonly syndicProfessionnel: boolean;
  readonly source: SourcePublique;
}

/**
 * Le syndic est-il PROFESSIONNEL ?
 *
 * DANS LE DOUTE, ON ÉCARTE. Un syndic bénévole ou coopératif est un
 * particulier ; un enregistrement dont on ne peut établir la nature n'est
 * jamais traité comme professionnel.
 */
export function estSyndicProfessionnel(c: z.infer<typeof Coproprietaire>): boolean {
  const marqueur = (c.type_syndic ?? c.syndic_type ?? c.nature_syndic ?? "").trim().toLowerCase();
  if (marqueur.length === 0) return false;
  const nom = c.denomination_syndic ?? c.nom_syndic ?? c.syndic_nom;
  return marqueur.includes("professionnel") && Boolean(nom);
}

function nomSyndicDe(c: z.infer<typeof Coproprietaire>): string | null {
  return c.denomination_syndic ?? c.nom_syndic ?? c.syndic_nom ?? null;
}

function formeRecue(brut: unknown): string {
  if (brut === null || typeof brut !== "object") return typeof brut;
  return Object.keys(brut as Record<string, unknown>).sort().join(", ") || "(objet vide)";
}

/**
 * Cherche des copropriétés dans une commune. Rend une liste, éventuellement
 * vide. Ne lève JAMAIS pour dire « rien trouvé ».
 */
export async function chercherSyndics(
  requete: { readonly commune: string | null; readonly codePostal: string | null },
  transport: TransportRnic = transportParDefaut,
): Promise<SyndicPublique[]> {
  const config = configRnic();
  const zone = requete.commune ?? requete.codePostal ?? "";
  const url = `${config.baseUrl}/records?where=commune%3D%22${encodeURIComponent(zone)}%22`;

  let reponse: { status: number; texte: string };
  try {
    reponse = await transport(url);
  } catch (err) {
    throw new RnicError(
      `Le RNIC est injoignable : ${err instanceof Error ? err.message : "erreur réseau"}.`,
    );
  }

  if (reponse.status < 200 || reponse.status >= 300) {
    throw new RnicError(`Le RNIC a répondu ${reponse.status}.`);
  }

  let brut: unknown;
  try {
    brut = JSON.parse(reponse.texte);
  } catch {
    throw new RnicError("Le RNIC a répondu autre chose que du JSON.");
  }

  const valide = ReponseRnic.safeParse(brut);
  if (!valide.success) {
    throw new RnicError(
      `La réponse du RNIC n'a pas la forme attendue. Champs reçus : ${formeRecue(brut)}. ` +
        `Corrigez le schéma dans lib/rnic-syndics.ts — ne devinez pas.`,
    );
  }

  const d = valide.data;
  const lignes = "results" in d ? d.results : d.data;

  return lignes.map((c) => ({
    commune: c.commune ?? null,
    codePostal: c.code_postal ?? null,
    nomSyndic: nomSyndicDe(c),
    syndicProfessionnel: estSyndicProfessionnel(c),
    source: config.source,
  }));
}

export interface AgregatSyndicsBenevoles {
  readonly commune: string;
  readonly occurrences: number;
}

/**
 * Agrège par commune les copropriétés dont le syndic n'est PAS professionnel
 * (bénévole, coopératif, ou nature indéterminée) — jamais de nom. C'est le
 * résultat qu'une route rend pour ces copropriétés-là ; le détail nominatif
 * ne concerne QUE `syndicProfessionnel === true`.
 */
export function agregerSyndicsBenevoles(
  syndics: readonly SyndicPublique[],
): AgregatSyndicsBenevoles[] {
  const compteur = new Map<string, number>();
  for (const s of syndics) {
    if (s.syndicProfessionnel || !s.commune) continue;
    compteur.set(s.commune, (compteur.get(s.commune) ?? 0) + 1);
  }
  return Array.from(compteur.entries()).map(([commune, occurrences]) => ({ commune, occurrences }));
}
