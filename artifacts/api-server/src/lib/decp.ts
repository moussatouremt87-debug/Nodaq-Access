/**
 * Interrogation des DECP — attributions de marchés publics, signal de
 * sous-traitance.
 *
 * ── LE TITULAIRE N'EST PAS TOUJOURS UNE PERSONNE MORALE ─────────────────────
 * Un entrepreneur individuel (artisan seul, auto-entrepreneur) a un SIRET et
 * peut parfaitement remporter un marché de petite commune — cas fréquent en
 * BTP. Le jeu de données `decp_augmente` n'expose AUCUN champ
 * `categorie_juridique`/`nature_juridique` permettant de trancher, contrairement
 * à l'annuaire d'entreprises. Ce module ne peut donc PAS distinguer un
 * titulaire société d'un titulaire artisan individuel.
 *
 * Conséquence : un titulaire nommé n'est JAMAIS rendu par défaut. Seuls des
 * AGRÉGATS anonymisés (secteur CPV × zone, sous le seuil de
 * `canauxProspection.ts` on se tait) sortent de `agregerParSecteurEtZone`. Le
 * détail nominatif (`AttributionPublique.titulaireNom`) existe dans le
 * résultat de `chercherAttributions` mais c'est à L'APPELANT — la route, via
 * `DECP_AFFICHER_TITULAIRES_PRO` — de décider s'il l'expose, jamais à ce
 * module.
 *
 * ── KEYLESS ──────────────────────────────────────────────────────────────────
 * L'API DECP (`data.economie.gouv.fr`, OpenDataSoft v2.1) répond sans clé —
 * confirmé par accès direct. `DECP_BASE_URL` reste sans valeur par défaut,
 * même doctrine que `LLM_BASE_URL`.
 *
 * ── LE TRANSPORT EST INJECTÉ ────────────────────────────────────────────────
 * Aucun test n'atteint le réseau.
 */
import { z } from "zod";
import type { SourcePublique } from "@nodaq/shared";
import { libelleSecteurCpv } from "@nodaq/shared";

export class DecpConfigError extends Error {
  constructor(
    message: string,
    readonly variableManquante: string,
  ) {
    super(message);
    this.name = "DecpConfigError";
  }
}

export class DecpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecpError";
  }
}

export type TransportDecp = (
  url: string,
) => Promise<{ status: number; texte: string }>;

const transportParDefaut: TransportDecp = async (url) => {
  const r = await fetch(url);
  return { status: r.status, texte: await r.text() };
};

export interface ConfigDecp {
  readonly baseUrl: string;
  readonly source: SourcePublique;
}

/** Lit la configuration. Lève `DecpConfigError` quand elle manque. */
export function configDecp(): ConfigDecp {
  const baseUrl = process.env["DECP_BASE_URL"]?.trim();
  if (!baseUrl) {
    throw new DecpConfigError(
      "DECP_BASE_URL n'est pas configurée : aucune attribution ne peut être justifiée.",
      "DECP_BASE_URL",
    );
  }
  const label = process.env["DECP_SOURCE_LABEL"]?.trim();
  const url = process.env["DECP_SOURCE_URL"]?.trim();
  if (!label || !url) {
    throw new DecpConfigError(
      "DECP_SOURCE_LABEL et DECP_SOURCE_URL doivent être définies : " +
        "une attribution sans source citable ne s'affiche pas.",
      label ? "DECP_SOURCE_URL" : "DECP_SOURCE_LABEL",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), source: { label, url } };
}

// ── La réponse DECP ──────────────────────────────────────────────────────────

// `.nullish()`, pas `.optional()` — même correction que dans boamp.ts, même
// famille d'API (OpenDataSoft) : un champ absent y vaut `null`, pas une clé
// omise, et `.optional()` seul rejetterait l'enregistrement entier.
const Attribution = z.object({
  siretetablissement: z.string().min(1).nullish(),
  denominationunitelegale: z.string().min(1).nullish(),
  denominationsocialeetablissement: z.string().min(1).nullish(),
  codecpv: z.string().nullish(),
  lieuexecutionnom: z.string().nullish(),
  codedepartementexecution: z.string().nullish(),
  montant: z.number().nullish(),
  datenotification: z.string().nullish(),
  objetmarche: z.string().nullish(),
});

const ReponseDecp = z.union([
  z.object({ results: z.array(Attribution) }),
  z.object({ records: z.array(Attribution) }),
]);

export interface AttributionPublique {
  readonly titulaireSiren: string | null;
  readonly titulaireNom: string | null;
  readonly secteur: string | null;
  readonly zone: string | null;
  readonly montant: number | null;
  readonly dateNotification: string | null;
  readonly objet: string | null;
  readonly source: SourcePublique;
}

function titulaireNomDe(a: z.infer<typeof Attribution>): string | null {
  return a.denominationsocialeetablissement ?? a.denominationunitelegale ?? null;
}

function formeRecue(brut: unknown): string {
  if (brut === null || typeof brut !== "object") return typeof brut;
  return Object.keys(brut as Record<string, unknown>).sort().join(", ") || "(objet vide)";
}

/**
 * Cherche des attributions dans un département, filtrées par pertinence
 * métier si `divisionsCpv` est fourni. Rend une liste, éventuellement vide.
 * Chaque ligne porte un titulaire nommé — c'est `agregerParSecteurEtZone`
 * qu'il faut appeler pour un résultat anonymisé.
 *
 * `codecpv_division` est un champ structuré à deux chiffres du jeu de
 * données réel (confirmé en lisant son schéma) — un filtre `where=`
 * fonctionne directement dessus, contrairement à BOAMP.
 */
export async function chercherAttributions(
  requete: { readonly departement: string | null; readonly codePostal: string | null },
  transport: TransportDecp = transportParDefaut,
  divisionsCpv?: readonly string[],
): Promise<AttributionPublique[]> {
  const config = configDecp();
  const dep = requete.departement ?? requete.codePostal?.slice(0, 2) ?? "";
  let url = `${config.baseUrl}/records?where=codedepartementexecution%3D%22${encodeURIComponent(dep)}%22`;
  if (divisionsCpv && divisionsCpv.length > 0) {
    const clause = divisionsCpv
      .map((d) => `codecpv_division%3D%22${encodeURIComponent(d)}%22`)
      .join("%20OR%20");
    url += `&where=(${clause})`;
  }

  let reponse: { status: number; texte: string };
  try {
    reponse = await transport(url);
  } catch (err) {
    throw new DecpError(
      `Les DECP sont injoignables : ${err instanceof Error ? err.message : "erreur réseau"}.`,
    );
  }

  if (reponse.status < 200 || reponse.status >= 300) {
    throw new DecpError(`Les DECP ont répondu ${reponse.status}.`);
  }

  let brut: unknown;
  try {
    brut = JSON.parse(reponse.texte);
  } catch {
    throw new DecpError("Les DECP ont répondu autre chose que du JSON.");
  }

  const valide = ReponseDecp.safeParse(brut);
  if (!valide.success) {
    throw new DecpError(
      `La réponse des DECP n'a pas la forme attendue. Champs reçus : ${formeRecue(brut)}. ` +
        `Corrigez le schéma dans lib/decp.ts — ne devinez pas.`,
    );
  }

  const d = valide.data;
  const lignes = "results" in d ? d.results : d.records;

  return lignes.map((a) => ({
    titulaireSiren: a.siretetablissement?.slice(0, 9) ?? null,
    titulaireNom: titulaireNomDe(a),
    secteur: a.codecpv ? libelleSecteurCpv(a.codecpv) : null,
    zone: a.lieuexecutionnom ?? null,
    montant: a.montant ?? null,
    dateNotification: a.datenotification ?? null,
    objet: a.objetmarche ?? null,
    source: config.source,
  }));
}

export interface AgregatSousTraitance {
  readonly secteur: string;
  readonly zone: string;
  readonly occurrences: number;
}

/**
 * Agrège par secteur × zone, sans AUCUN titulaire nommé. C'est le résultat
 * qu'une route rend PAR DÉFAUT — le détail nominatif de
 * `chercherAttributions` reste gaté par `DECP_AFFICHER_TITULAIRES_PRO` côté
 * appelant.
 */
export function agregerParSecteurEtZone(
  attributions: readonly AttributionPublique[],
): AgregatSousTraitance[] {
  // Séparateur improbable dans un libellé de secteur ou une commune : évite de
  // recomposer la clé en la découpant sur un espace, qui apparaît dans les
  // deux (« Gros œuvre et maçonnerie », « Saint-Étienne-du-Rouvray »).
  const SEP = "␟";
  const compteur = new Map<string, { secteur: string; zone: string; occurrences: number }>();
  for (const a of attributions) {
    if (!a.secteur || !a.zone) continue;
    const cle = `${a.secteur}${SEP}${a.zone}`;
    const existant = compteur.get(cle);
    if (existant) {
      existant.occurrences++;
    } else {
      compteur.set(cle, { secteur: a.secteur, zone: a.zone, occurrences: 1 });
    }
  }
  return Array.from(compteur.values());
}
