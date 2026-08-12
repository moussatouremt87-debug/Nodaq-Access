/**
 * Interrogation d'une source PUBLIQUE de permis de construire (Sitadel).
 *
 * ── CE QUE CE MODULE NE FAIT JAMAIS ─────────────────────────────────────────
 * Il n'invente aucun permis. Sans source configurée, il ne rend RIEN — c'est
 * l'appelant qui le dit à l'écran, comme `annuaire-entreprises.ts`.
 *
 * ── LE DEMANDEUR PEUT ÊTRE UN PARTICULIER ───────────────────────────────────
 * Un permis de construire résidentiel porte très souvent le nom du
 * propriétaire — une personne PHYSIQUE. `estDemandeurPersonneMorale` applique
 * la même doctrine que `estPersonneMorale` dans `annuaire-entreprises.ts` :
 * dans le doute, on écarte. C'est à l'APPELANT (la route) de décider, via le
 * réglage `PERMIS_AFFICHER_PISTES_PRO`, si un demandeur professionnel nommé
 * est exposé comme piste — ce module ne fait que qualifier chaque ligne.
 *
 * ── FORME NON CONFIRMÉE ──────────────────────────────────────────────────────
 * Le champ distinguant personne physique/morale n'a pas pu être confronté à
 * une vraie réponse du fournisseur : ni compte ni clé n'existent au moment de
 * l'écriture de ce module. Le schéma accepte plusieurs noms de champs
 * plausibles et REFUSE bruyamment le reste — il ne devine jamais.
 *
 * ── LE TRANSPORT EST INJECTÉ ────────────────────────────────────────────────
 * Aucun test n'atteint le réseau.
 */
import { z } from "zod";
import type { SourcePublique } from "@nodaq/shared";

export class PermisConfigError extends Error {
  constructor(
    message: string,
    readonly variableManquante: string,
  ) {
    super(message);
    this.name = "PermisConfigError";
  }
}

export class PermisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermisError";
  }
}

/** Le transport HTTP, injectable — la clé passe en en-tête, comme `TransportTem`. */
export type TransportPermis = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; texte: string }>;

const transportParDefaut: TransportPermis = async (url, init) => {
  const r = await fetch(url, { headers: init.headers });
  return { status: r.status, texte: await r.text() };
};

export interface ConfigPermis {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly source: SourcePublique;
}

/**
 * Lit la configuration. Lève `PermisConfigError` dès qu'il manque quelque
 * chose — aucune valeur par défaut, et la clé n'apparaît dans aucun message.
 */
export function configPermis(): ConfigPermis {
  const baseUrl = process.env["PERMIS_BASE_URL"]?.trim();
  if (!baseUrl) {
    throw new PermisConfigError(
      "PERMIS_BASE_URL n'est pas configurée : aucun signal de permis ne peut être justifié.",
      "PERMIS_BASE_URL",
    );
  }
  const apiKey = process.env["PERMIS_API_KEY"]?.trim();
  if (!apiKey) {
    throw new PermisConfigError(
      "PERMIS_API_KEY n'est pas configurée : le fournisseur exige une clé.",
      "PERMIS_API_KEY",
    );
  }
  const label = process.env["PERMIS_SOURCE_LABEL"]?.trim();
  const url = process.env["PERMIS_SOURCE_URL"]?.trim();
  if (!label || !url) {
    throw new PermisConfigError(
      "PERMIS_SOURCE_LABEL et PERMIS_SOURCE_URL doivent être définies : " +
        "un signal sans source citable ne s'affiche pas.",
      label ? "PERMIS_SOURCE_URL" : "PERMIS_SOURCE_LABEL",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, source: { label, url } };
}

// ── La réponse du fournisseur ────────────────────────────────────────────────

/**
 * Formes ACCEPTÉES. La forme réelle n'a pas pu être confrontée au service —
 * ni clé ni compte au moment de l'écriture. Ce qui ne correspond à aucune est
 * REFUSÉ, jamais deviné.
 */
const Permis = z.object({
  numero: z.string().min(1).optional(),
  nature: z.string().optional(),
  demandeur_nom: z.string().min(1).optional(),
  nom_demandeur: z.string().min(1).optional(),
  raison_sociale: z.string().min(1).optional(),
  /** Marqueurs candidats pour la nature du demandeur — noms non confirmés. */
  type_demandeur: z.string().optional(),
  nature_demandeur: z.string().optional(),
  demandeur_type: z.string().optional(),
  adresse: z.string().optional(),
  code_postal: z.string().optional(),
  commune: z.string().optional(),
  date_octroi: z.string().optional(),
});

const ReponsePermis = z.union([
  z.object({ results: z.array(Permis) }),
  z.object({ permits: z.array(Permis) }),
  z.object({ data: z.array(Permis) }),
]);

export interface PermisPublic {
  readonly numero: string | null;
  readonly nature: string | null;
  readonly nomDemandeur: string | null;
  readonly demandeurPersonneMorale: boolean;
  readonly adresse: string | null;
  readonly codePostal: string | null;
  readonly commune: string | null;
  readonly dateOctroi: string | null;
  readonly source: SourcePublique;
}

/**
 * Le demandeur est-il une personne MORALE ?
 *
 * DANS LE DOUTE, ON ÉCARTE — même doctrine que `estPersonneMorale` dans
 * `annuaire-entreprises.ts`. Un enregistrement dont on ne peut établir la
 * nature n'est jamais traité comme professionnel : mieux vaut manquer une
 * piste que présenter un particulier comme cible de démarchage.
 */
export function estDemandeurPersonneMorale(p: z.infer<typeof Permis>): boolean {
  const marqueur = (p.type_demandeur ?? p.nature_demandeur ?? p.demandeur_type ?? "")
    .trim()
    .toLowerCase();
  if (marqueur.length === 0) return false;
  const morale = marqueur.includes("morale") || marqueur.includes("entreprise") || marqueur.includes("societe") || marqueur.includes("société");
  const nom = p.raison_sociale ?? p.demandeur_nom ?? p.nom_demandeur;
  return morale && Boolean(nom);
}

function nomDemandeurDe(p: z.infer<typeof Permis>): string | null {
  return p.raison_sociale ?? p.demandeur_nom ?? p.nom_demandeur ?? null;
}

function formeRecue(brut: unknown): string {
  if (brut === null || typeof brut !== "object") return typeof brut;
  return Object.keys(brut as Record<string, unknown>).sort().join(", ") || "(objet vide)";
}

/**
 * Cherche des permis dans une zone. Rend une liste, éventuellement vide.
 *
 * Ne lève JAMAIS pour dire « rien trouvé ». Lève quand la configuration
 * manque, quand le service répond mal, ou quand la forme est inconnue.
 */
export async function chercherPermis(
  requete: { readonly commune: string | null; readonly codePostal: string | null },
  transport: TransportPermis = transportParDefaut,
): Promise<PermisPublic[]> {
  const config = configPermis();
  const zone = requete.commune ?? requete.codePostal ?? "";
  const url = `${config.baseUrl}/v1/permits?commune=${encodeURIComponent(zone)}`;

  let reponse: { status: number; texte: string };
  try {
    reponse = await transport(url, { headers: { "X-API-Key": config.apiKey } });
  } catch (err) {
    throw new PermisError(
      `La source des permis est injoignable : ${err instanceof Error ? err.message : "erreur réseau"}.`,
    );
  }

  if (reponse.status < 200 || reponse.status >= 300) {
    throw new PermisError(`La source des permis a répondu ${reponse.status}.`);
  }

  let brut: unknown;
  try {
    brut = JSON.parse(reponse.texte);
  } catch {
    throw new PermisError("La source des permis a répondu autre chose que du JSON.");
  }

  const valide = ReponsePermis.safeParse(brut);
  if (!valide.success) {
    throw new PermisError(
      `La réponse de la source des permis n'a pas la forme attendue. Champs reçus : ${formeRecue(brut)}. ` +
        `Corrigez le schéma dans lib/permis-construire.ts — ne devinez pas.`,
    );
  }

  const d = valide.data;
  const lignes = "results" in d ? d.results : "permits" in d ? d.permits : d.data;

  return lignes.map((p) => ({
    numero: p.numero ?? null,
    nature: p.nature ?? null,
    nomDemandeur: nomDemandeurDe(p),
    demandeurPersonneMorale: estDemandeurPersonneMorale(p),
    adresse: p.adresse ?? null,
    codePostal: p.code_postal ?? null,
    commune: p.commune ?? null,
    dateOctroi: p.date_octroi ?? null,
    source: config.source,
  }));
}
