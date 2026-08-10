/**
 * Interrogation d'un annuaire PUBLIC d'entreprises.
 *
 * ── CE QUE CE MODULE NE FAIT JAMAIS ─────────────────────────────────────────
 * Il n'invente aucune entreprise. Sans source configurée, il ne rend RIEN et
 * le dit — c'est la règle du lot : une suggestion sans source vérifiable ne
 * s'affiche pas. Un annuaire imaginaire ferait démarcher des sociétés qui
 * n'existent pas, avec des coordonnées inventées.
 *
 * ── UNIQUEMENT DES PERSONNES MORALES ────────────────────────────────────────
 * Les annuaires publics d'entreprises contiennent aussi des ENTREPRENEURS
 * INDIVIDUELS, qui sont des personnes physiques. Les proposer comme cible
 * reviendrait à proposer un particulier — ce que le produit s'interdit.
 * `estPersonneMorale` les écarte, et un enregistrement dont on ne peut pas
 * établir la nature est écarté AUSSI : dans le doute, on ne démarche pas.
 *
 * ── AUCUNE URL EN DUR ───────────────────────────────────────────────────────
 * `ANNUAIRE_BASE_URL` vient de la configuration, sans valeur par défaut —
 * même doctrine que `LLM_BASE_URL` et `TEM_BASE_URL`.
 *
 * ── LE TRANSPORT EST INJECTÉ ────────────────────────────────────────────────
 * Aucun test n'atteint le réseau.
 */
import { z } from "zod";
import type { SourcePublique } from "@nodaq/shared";

export class AnnuaireConfigError extends Error {
  constructor(
    message: string,
    readonly variableManquante: string,
  ) {
    super(message);
    this.name = "AnnuaireConfigError";
  }
}

export class AnnuaireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnuaireError";
  }
}

export type TransportAnnuaire = (
  url: string,
) => Promise<{ status: number; texte: string }>;

const transportParDefaut: TransportAnnuaire = async (url) => {
  const r = await fetch(url);
  return { status: r.status, texte: await r.text() };
};

export interface ConfigAnnuaire {
  readonly baseUrl: string;
  readonly source: SourcePublique;
}

/**
 * Lit la configuration. Lève quand elle manque.
 *
 * Le LABEL de la source est configuré lui aussi : c'est ce qui sera cité à
 * l'artisan, et l'écrire en dur ici ferait mentir l'écran le jour où la source
 * change.
 */
export function configAnnuaire(): ConfigAnnuaire {
  const baseUrl = process.env["ANNUAIRE_BASE_URL"]?.trim();
  if (!baseUrl) {
    throw new AnnuaireConfigError(
      "ANNUAIRE_BASE_URL n'est pas configurée : aucune suggestion ne peut être justifiée.",
      "ANNUAIRE_BASE_URL",
    );
  }
  const label = process.env["ANNUAIRE_SOURCE_LABEL"]?.trim();
  const url = process.env["ANNUAIRE_SOURCE_URL"]?.trim();
  if (!label || !url) {
    throw new AnnuaireConfigError(
      "ANNUAIRE_SOURCE_LABEL et ANNUAIRE_SOURCE_URL doivent être définies : " +
        "une suggestion sans source citable ne s'affiche pas.",
      label ? "ANNUAIRE_SOURCE_URL" : "ANNUAIRE_SOURCE_LABEL",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), source: { label, url } };
}

// ── La réponse de l'annuaire ─────────────────────────────────────────────────

/**
 * Formes acceptées. La forme réelle n'a pas pu être confrontée au service —
 * il n'y a ni accès réseau ni configuration ici. Ce qui ne correspond à aucune
 * est REFUSÉ, jamais deviné.
 */
const Etablissement = z.object({
  siren: z.string().min(1).optional(),
  siret: z.string().min(1).optional(),
  nom_complet: z.string().min(1).optional(),
  nom_raison_sociale: z.string().min(1).optional(),
  denomination: z.string().min(1).optional(),
  /** Marqueur de personne physique selon les annuaires publics français. */
  nature_juridique: z.string().optional(),
  categorie_juridique: z.string().optional(),
  adresse: z.string().optional(),
  code_postal: z.string().optional(),
  commune: z.string().optional(),
  ville: z.string().optional(),
});

const ReponseAnnuaire = z.union([
  z.object({ results: z.array(Etablissement) }),
  z.object({ etablissements: z.array(Etablissement) }),
  z.object({ data: z.array(Etablissement) }),
]);

export interface EntreprisePublique {
  readonly siren: string | null;
  readonly nom: string;
  readonly adresse: string | null;
  readonly codePostal: string | null;
  readonly ville: string | null;
  /** La source, citée telle qu'elle sera affichée. */
  readonly source: SourcePublique;
}

/**
 * Une personne MORALE ?
 *
 * Les catégories juridiques françaises commençant par « 1 » désignent les
 * entrepreneurs individuels — des personnes PHYSIQUES. Les proposer comme
 * cible reviendrait à proposer un particulier.
 *
 * DANS LE DOUTE, ON ÉCARTE. Un enregistrement sans catégorie juridique n'est
 * pas retenu : mieux vaut manquer une entreprise que démarcher une personne.
 */
export function estPersonneMorale(e: z.infer<typeof Etablissement>): boolean {
  const code = (e.categorie_juridique ?? e.nature_juridique ?? "").trim();
  if (code.length === 0) return false;
  return !code.startsWith("1");
}

function nomDe(e: z.infer<typeof Etablissement>): string | null {
  return e.nom_complet ?? e.nom_raison_sociale ?? e.denomination ?? null;
}

function formeRecue(brut: unknown): string {
  if (brut === null || typeof brut !== "object") return typeof brut;
  return Object.keys(brut as Record<string, unknown>).sort().join(", ") || "(objet vide)";
}

/**
 * Cherche des entreprises. Rend une liste, éventuellement vide.
 *
 * Ne lève JAMAIS pour dire « rien trouvé » : une recherche sans résultat est
 * un résultat. Elle lève quand la configuration manque, quand le service
 * répond mal, ou quand la forme est inconnue — trois cas où continuer
 * reviendrait à inventer.
 */
export async function chercherEntreprises(
  requete: { readonly quoi: string; readonly ou: string },
  transport: TransportAnnuaire = transportParDefaut,
): Promise<EntreprisePublique[]> {
  const config = configAnnuaire();
  const url =
    `${config.baseUrl}/search` +
    `?q=${encodeURIComponent(requete.quoi)}` +
    `&ou=${encodeURIComponent(requete.ou)}`;

  let reponse: { status: number; texte: string };
  try {
    reponse = await transport(url);
  } catch (err) {
    throw new AnnuaireError(
      `L'annuaire public est injoignable : ${err instanceof Error ? err.message : "erreur réseau"}.`,
    );
  }

  if (reponse.status < 200 || reponse.status >= 300) {
    throw new AnnuaireError(`L'annuaire public a répondu ${reponse.status}.`);
  }

  let brut: unknown;
  try {
    brut = JSON.parse(reponse.texte);
  } catch {
    throw new AnnuaireError("L'annuaire public a répondu autre chose que du JSON.");
  }

  const valide = ReponseAnnuaire.safeParse(brut);
  if (!valide.success) {
    throw new AnnuaireError(
      `La réponse de l'annuaire n'a pas la forme attendue. Champs reçus : ${formeRecue(brut)}. ` +
        `Corrigez le schéma dans lib/annuaire-entreprises.ts — ne devinez pas.`,
    );
  }

  const d = valide.data;
  const lignes =
    "results" in d ? d.results : "etablissements" in d ? d.etablissements : d.data;

  return lignes
    // Les personnes physiques sont écartées AVANT tout autre traitement.
    .filter(estPersonneMorale)
    .map((e) => {
      const nom = nomDe(e);
      if (!nom) return null;
      return {
        siren: e.siren ?? e.siret?.slice(0, 9) ?? null,
        nom,
        adresse: e.adresse ?? null,
        codePostal: e.code_postal ?? null,
        ville: e.commune ?? e.ville ?? null,
        source: config.source,
      };
    })
    .filter((e): e is EntreprisePublique => e !== null);
}
