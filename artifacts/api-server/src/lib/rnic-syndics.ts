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

// `.nullish()`, pas `.optional()` — même correction que boamp.ts/decp.ts,
// appliquée par précaution avant même un premier accès réel : les deux
// autres sources OpenDataSoft de ce lot rendaient `null` pour un champ
// absent, jamais une clé omise, et `.optional()` seul rejetait la ligne
// entière.
const Coproprietaire = z.object({
  commune: z.string().nullish(),
  code_postal: z.string().nullish(),
  /**
   * Le nom du syndic. `raison_sociale_representant` est celui que porte
   * RÉELLEMENT le registre — confronté à la source le 28/08/2026. Les trois
   * autres étaient des candidats plausibles, écrits avant tout accès réel ;
   * ils sont CONSERVÉS, parce qu'un portail qui republierait le registre
   * sous un autre nom de colonne resterait lisible sans retoucher ce fichier.
   */
  raison_sociale_representant: z.string().min(1).nullish(),
  nom_syndic: z.string().min(1).nullish(),
  syndic_nom: z.string().min(1).nullish(),
  denomination_syndic: z.string().min(1).nullish(),
  /** Marqueurs candidats — noms non confirmés. */
  type_syndic: z.string().nullish(),
  syndic_type: z.string().nullish(),
  nature_syndic: z.string().nullish(),
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
  const nom = nomSyndicDe(c);
  return marqueur.includes("professionnel") && Boolean(nom);
}

function nomSyndicDe(c: z.infer<typeof Coproprietaire>): string | null {
  return (
    c.raison_sociale_representant ??
    c.denomination_syndic ??
    c.nom_syndic ??
    c.syndic_nom ??
    null
  );
}

/**
 * Combien de copropriétés on demande en une fois.
 *
 * CE N'EST PAS UN CONFORT : sans ce paramètre, l'API rend **12 lignes** par
 * défaut — mesuré. Nantes en compte 1 413. On aurait donc agrégé un
 * échantillon d'un pour cent en le présentant comme le total de la commune,
 * sans qu'aucune erreur ne le dise.
 *
 * 10 000 est le plus grand que l'API accepte (20 000 échoue). Une seule
 * commune de France le dépasse — PARIS, 10 713 copropriétés au 28/08/2026 —
 * et y sera donc tronquée d'environ 7 %. Un artisan parisien qui veut une
 * liste exacte doit filtrer par code postal, ce que cette fonction fait déjà
 * quand la commune n'est pas renseignée.
 */
const TAILLE_PAGE = 10_000;

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
  const champ = requete.commune ? "commune_in" : "code_postal_in";
  const url =
    `${config.baseUrl}/lines?${champ}=${encodeURIComponent(zone)}` +
    `&size=${TAILLE_PAGE}` +
    `&select=commune,code_postal,type_syndic,raison_sociale_representant`;

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
