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
// `.nullish()`, pas `.optional()` : les trois autres sources de ce lot
// (BOAMP, DECP, RNIC — même famille OpenDataSoft) rendent `null` pour un
// champ absent, jamais une clé omise, et un accès réel à celle-ci n'a pas pu
// être confronté ce soir. Même précaution ici par cohérence.
/**
 * ── LES NOMS DE CHAMPS DE LA SOURCE ───────────────────────────────────────
 * Confronté au service réel le 28/08/2026 (point d'accès d'essai public).
 * TOUS les champs qu'il rend portent des noms de colonnes Sitadel verbatim —
 * `num_pa`, `comm_code`, `date_reelle_autorisation`, `superficie_terrain`.
 * Le service republie donc la base Sitadel sans renommer, ce qui rend les
 * noms de demandeur (`denom_dem`, `cj_dem`, `siret_dem`) hautement probables :
 * ce sont ceux de la base ouverte, vérifiés le même jour.
 *
 * « Hautement probable » n'est pas « vérifié » : l'essai public ne rend AUCUN
 * champ sur le demandeur. Ils sont donc ajoutés en candidats, et le schéma
 * continue de REFUSER bruyamment ce qu'il ne reconnaît pas — au premier appel
 * avec une vraie clé, le message d'erreur nommera les champs reçus.
 *
 * Les noms supposés d'origine sont CONSERVÉS : ils ne coûtent rien et
 * couvrent un autre republieur.
 */
const Permis = z.object({
  numero: z.string().min(1).nullish(),
  /** Sitadel : identifiant du dossier. Vérifié sur l'essai public. */
  num_pa: z.string().min(1).nullish(),
  nature: z.string().nullish(),
  /** Sitadel : `PC`, `DP_LOGEMENT`… Vérifié sur l'essai public. */
  permit_type: z.string().nullish(),
  demandeur_nom: z.string().min(1).nullish(),
  nom_demandeur: z.string().min(1).nullish(),
  raison_sociale: z.string().min(1).nullish(),
  /** Sitadel : dénomination du demandeur. VIDE pour un particulier. */
  denom_dem: z.string().min(1).nullish(),
  /**
   * Sitadel : catégorie juridique INSEE du demandeur. Sa PRÉSENCE est le
   * marqueur de personne morale — mesuré sur la base ouverte : les
   * particuliers n'en portent aucune, les sociétés, communes et associations
   * en portent toujours une (`5710` SAS, `6540` SCI, `7210` commune…).
   */
  cj_dem: z.string().min(1).nullish(),
  /** Marqueurs candidats pour la nature du demandeur — noms non confirmés. */
  type_demandeur: z.string().nullish(),
  nature_demandeur: z.string().nullish(),
  demandeur_type: z.string().nullish(),
  adresse: z.string().nullish(),
  code_postal: z.string().nullish(),
  commune: z.string().nullish(),
  /** Sitadel : nom de la commune. Vérifié sur l'essai public. */
  localite: z.string().nullish(),
  date_octroi: z.string().nullish(),
  /** Sitadel : date d'autorisation réelle. Vérifiée sur l'essai public. */
  date_reelle_autorisation: z.string().nullish(),
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
  const nom = nomDemandeurDe(p);
  if (!nom) return false;

  // La CATÉGORIE JURIDIQUE d'abord : c'est le marqueur de la source réelle,
  // et il ne se prête à aucune interprétation. Mesuré sur la base ouverte :
  // un particulier n'en porte jamais, une personne morale en porte toujours
  // une. Pas de liste de mots à faire correspondre, donc pas de dérive le
  // jour où le libellé change.
  if ((p.cj_dem ?? "").trim().length > 0) return true;

  // À défaut, les marqueurs textuels supposés. Conservés pour un republieur
  // qui n'exposerait pas la catégorie juridique.
  const marqueur = (p.type_demandeur ?? p.nature_demandeur ?? p.demandeur_type ?? "")
    .trim()
    .toLowerCase();
  if (marqueur.length === 0) return false;
  return (
    marqueur.includes("morale") ||
    marqueur.includes("entreprise") ||
    marqueur.includes("societe") ||
    marqueur.includes("société")
  );
}

function nomDemandeurDe(p: z.infer<typeof Permis>): string | null {
  return p.denom_dem ?? p.raison_sociale ?? p.demandeur_nom ?? p.nom_demandeur ?? null;
}

function formeRecue(brut: unknown): string {
  if (brut === null || typeof brut !== "object") return typeof brut;
  return Object.keys(brut as Record<string, unknown>).sort().join(", ") || "(objet vide)";
}

/**
 * Le département, déduit du code postal.
 *
 * La source filtre par DÉPARTEMENT (`dep_code`), pas par commune — confronté
 * au service réel le 28/08/2026. C'est plus large que la zone de l'artisan,
 * et c'est assumé : un permis à trente kilomètres reste une piste, là où un
 * marché public à trente kilomètres n'en est pas une.
 *
 * Trois cas, et le troisième n'a pas de bonne réponse :
 *
 * - OUTRE-MER : `971`…`988` tiennent sur TROIS chiffres. Les couper à deux
 *   donnerait `97` pour la Guadeloupe comme pour Mayotte.
 * - MÉTROPOLE : les deux premiers chiffres.
 * - CORSE : `20xxx` couvre `2A` ET `2B`, et le code postal seul ne permet pas
 *   de trancher — la limite administrative ne suit pas les tranches postales
 *   partout. On REFUSE plutôt que de deviner : envoyer un artisan d'Ajaccio
 *   démarcher en Haute-Corse serait une erreur silencieuse, et il n'aurait
 *   aucun moyen de comprendre pourquoi ses pistes sont à deux heures de
 *   route.
 */
export function departementDepuisCodePostal(codePostal: string | null): string | null {
  const cp = (codePostal ?? "").trim();
  if (!/^\d{5}$/.test(cp)) return null;
  if (cp.startsWith("97") || cp.startsWith("98")) return cp.slice(0, 3);
  if (cp.startsWith("20")) return null;
  return cp.slice(0, 2);
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

  // La source filtre par département. Le code postal est donc la SEULE entrée
  // exploitable : la commune, elle, ne s'y traduit pas.
  const departement = departementDepuisCodePostal(requete.codePostal);
  if (departement === null) {
    throw new PermisError(
      "Les permis de construire se cherchent par département, déduit du code " +
        "postal. Renseignez un code postal à cinq chiffres dans le profil de " +
        "l'entreprise. (La Corse n'est pas encore couverte : le code postal n'y " +
        "permet pas de distinguer la Corse-du-Sud de la Haute-Corse, et nous " +
        "préférons ne rien proposer plutôt que de vous envoyer dans le mauvais " +
        "département.)",
    );
  }

  const url = `${config.baseUrl}/v1/permits?dep_code=${encodeURIComponent(departement)}`;

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
    numero: p.numero ?? p.num_pa ?? null,
    nature: p.nature ?? p.permit_type ?? null,
    nomDemandeur: nomDemandeurDe(p),
    demandeurPersonneMorale: estDemandeurPersonneMorale(p),
    adresse: p.adresse ?? null,
    codePostal: p.code_postal ?? null,
    commune: p.commune ?? p.localite ?? null,
    dateOctroi: p.date_octroi ?? p.date_reelle_autorisation ?? null,
    source: config.source,
  }));
}
