/**
 * Interrogation du BOAMP — avis de marchés publics.
 *
 * ── LA SOURCE LA PLUS PROPRE DU LOT ──────────────────────────────────────────
 * Le côté ACHETEUR d'un avis BOAMP est TOUJOURS un organisme public — aucun
 * champ « soumissionnaire » n'existe dans un avis. Il n'y a donc AUCUNE
 * personne physique possible dans cette source, et aucune fonction
 * `estPersonneMorale`-équivalente n'est nécessaire ici, contrairement à
 * `annuaire-entreprises.ts` ou `permis-construire.ts`.
 *
 * ── PREMIÈRE SOURCE RÉELLEMENT KEYLESS DU DÉPÔT ─────────────────────────────
 * L'API BOAMP (DILA, `boamp-datadila.opendatasoft.com`) répond sans clé —
 * confirmé par accès direct. `BOAMP_BASE_URL` reste néanmoins sans valeur par
 * défaut, même doctrine que `LLM_BASE_URL` : une URL de fournisseur change
 * sans préavis, et un code qui la porte en dur PARAÎT juste tout en échouant
 * en production.
 *
 * ── FORME NON CONFIRMÉE ──────────────────────────────────────────────────────
 * L'enveloppe JSON de premier niveau (forme standard OpenDataSoft v2.1
 * supposée : `{total_count, results}`) n'a pas été confrontée en JSON brut —
 * seulement résumée. Ce qui ne correspond à aucune forme acceptée est REFUSÉ,
 * jamais deviné.
 *
 * ── LE TRANSPORT EST INJECTÉ ────────────────────────────────────────────────
 * Aucun test n'atteint le réseau.
 */
import { z } from "zod";
import type { SourcePublique } from "@nodaq/shared";
import { toDateString } from "@nodaq/shared";

export class BoampConfigError extends Error {
  constructor(
    message: string,
    readonly variableManquante: string,
  ) {
    super(message);
    this.name = "BoampConfigError";
  }
}

export class BoampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoampError";
  }
}

export type TransportBoamp = (
  url: string,
) => Promise<{ status: number; texte: string }>;

const transportParDefaut: TransportBoamp = async (url) => {
  const r = await fetch(url);
  return { status: r.status, texte: await r.text() };
};

export interface ConfigBoamp {
  readonly baseUrl: string;
  readonly source: SourcePublique;
}

/** Lit la configuration. Lève `BoampConfigError` quand elle manque. */
export function configBoamp(): ConfigBoamp {
  const baseUrl = process.env["BOAMP_BASE_URL"]?.trim();
  if (!baseUrl) {
    throw new BoampConfigError(
      "BOAMP_BASE_URL n'est pas configurée : aucun marché ne peut être justifié.",
      "BOAMP_BASE_URL",
    );
  }
  const label = process.env["BOAMP_SOURCE_LABEL"]?.trim();
  const url = process.env["BOAMP_SOURCE_URL"]?.trim();
  if (!label || !url) {
    throw new BoampConfigError(
      "BOAMP_SOURCE_LABEL et BOAMP_SOURCE_URL doivent être définies : " +
        "un marché sans source citable ne s'affiche pas.",
      label ? "BOAMP_SOURCE_URL" : "BOAMP_SOURCE_LABEL",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), source: { label, url } };
}

// ── La réponse du BOAMP ──────────────────────────────────────────────────────

// `.nullish()`, pas `.optional()` : confronté à un vrai accès (boamp-datadila.
// opendatasoft.com), un champ absent y vaut explicitement `null`, pas une clé
// omise. `.optional()` n'accepte que `undefined` — chaque enregistrement où
// `datelimitereponse` valait `null` (avis sans date limite) faisait échouer
// TOUT le tableau, un exemple concret de la garde « on refuse plutôt que
// deviner » qui s'est déclenchée en conditions réelles.
const AvisMarche = z.object({
  objet: z.string().min(1).nullish(),
  titre_marche: z.string().min(1).nullish(),
  nomacheteur: z.string().min(1).nullish(),
  denomination: z.string().min(1).nullish(),
  cpv: z.array(z.string()).nullish(),
  code_departement: z.array(z.string()).nullish(),
  adresse: z.string().nullish(),
  datelimitereponse: z.string().nullish(),
  /** Date de publication de l'avis. Sert au tri, et s'affiche. */
  dateparution: z.string().nullish(),
  procedure_libelle: z.string().nullish(),
  nature_libelle: z.string().nullish(),
});

const ReponseBoamp = z.union([
  z.object({ results: z.array(AvisMarche) }),
  z.object({ records: z.array(AvisMarche) }),
]);

export interface MarchePublic {
  readonly objet: string | null;
  readonly acheteur: string | null;
  readonly cpv: readonly string[];
  readonly departements: readonly string[];
  readonly adresse: string | null;
  readonly dateLimiteReponse: string | null;
  /** Quand l'avis a été publié — ce qui fait qu'il est « récent », ou non. */
  readonly dateParution: string | null;
  readonly natureProcedure: string | null;
  readonly source: SourcePublique;
}

/**
 * Le département tel que le BOAMP l'écrit — et il l'écrit à SA façon.
 *
 * ── LE DÉFAUT QUE CETTE FONCTION CORRIGE ────────────────────────────────────
 * Le module composait le département avec `codePostal.slice(0, 2)`, ce qui
 * donne « 02 » pour l'Aisne et « 06 » pour les Alpes-Maritimes. Or ce jeu de
 * données stocke les départements métropolitains SANS zéro initial. Mesuré sur
 * la source, le 28/08/2026 :
 *
 *     code_departement="02" →      0 avis        code_departement="2" → 19 243
 *     code_departement="06" →      0 avis        code_departement="6" → 44 287
 *
 * Un artisan de l'Aisne, de l'Ain, de l'Allier, des Alpes, de l'Ardèche, des
 * Ardennes ou de l'Ariège voyait donc un écran d'appels d'offres VIDE en
 * permanence — sous un message lui affirmant que rien n'était publié dans sa
 * zone. Le produit lui mentait sans le savoir, et rien ne pouvait le signaler :
 * zéro résultat est une réponse parfaitement valide.
 *
 * ── ET POURQUOI ELLE N'EST PAS PARTAGÉE AVEC LE DECP ────────────────────────
 * Le DECP fait exactement L'INVERSE — mesuré le même jour, il stocke « 02 » et
 * « 06 » AVEC leur zéro, et ne connaît ni « 2 » ni « 6 ». Une normalisation
 * commune aux deux sources casserait celle qui fonctionne. Chaque source a son
 * vocabulaire ; on l'apprend d'elle, on ne le lui impose pas.
 *
 * ── LA CORSE EST REFUSÉE, PAS DEVINÉE ───────────────────────────────────────
 * Le BOAMP l'écrit « 20A » et « 20B » (relevé dans sa facette : ni « 2A », ni
 * « 2B », ni « 20 » ne rendent quoi que ce soit). Or le code postal ne dit pas
 * de façon fiable de quel des deux départements il relève. On rend `null`,
 * comme `departementDepuisCodePostal` le fait déjà pour les permis : mieux
 * vaut une section qui se tait qu'une section qui affiche l'autre Corse.
 */
export function departementBoamp(codePostal: string | null): string | null {
  const cp = (codePostal ?? "").trim();
  if (!/^\d{5}$/.test(cp)) return null;
  // Outre-mer : trois chiffres, et aucun zéro initial à retirer.
  if (cp.startsWith("97") || cp.startsWith("98")) return cp.slice(0, 3);
  if (cp.startsWith("20")) return null;
  const deux = cp.slice(0, 2);
  return deux.startsWith("0") ? deux.slice(1) : deux;
}

/**
 * Combien d'avis on demande.
 *
 * Sans `limit`, cette API en rend DIX. Avec `order_by` désormais posé, ces dix
 * seraient les bons — mais dix avis pour un département entier est une vue
 * étriquée, et 100 est le maximum que l'API accepte (`limit=101` est refusé
 * en toutes lettres). Même piège que `TAILLE_PAGE` côté RNIC.
 */
const TAILLE_PAGE = 100;

function objetDe(a: z.infer<typeof AvisMarche>): string | null {
  return a.objet ?? a.titre_marche ?? null;
}

function acheteurDe(a: z.infer<typeof AvisMarche>): string | null {
  return a.nomacheteur ?? a.denomination ?? null;
}

function formeRecue(brut: unknown): string {
  if (brut === null || typeof brut !== "object") return typeof brut;
  return Object.keys(brut as Record<string, unknown>).sort().join(", ") || "(objet vide)";
}

/**
 * Cherche des marchés publics dans un département, filtrés par pertinence
 * métier si `motsCles` est fourni.
 *
 * ── POURQUOI UNE RECHERCHE PLEIN TEXTE, PAS UN FILTRE CPV ───────────────────
 * Le jeu de données BOAMP n'expose AUCUN champ CPV interrogeable — confirmé
 * en lisant son schéma réel (`descripteur_code`/`descripteur_libelle` sont un
 * thésaurus français, pas la nomenclature CPV). `motsCles` construit donc une
 * recherche plein texte, le seul mécanisme de pertinence que cette source
 * permette honnêtement — via `search(objet, "terme")` DANS `where=`, pas via
 * un paramètre `q=` séparé : celui-ci s'est révélé purement ignoré par cette
 * API en le confrontant à un vrai accès (`total_count` identique avec et
 * sans lui).
 *
 * Ne lève JAMAIS pour dire « rien trouvé ». Lève quand la configuration
 * manque, quand le service répond mal, ou quand la forme est inconnue.
 */
export async function chercherMarches(
  requete: { readonly departement: string | null; readonly codePostal: string | null },
  transport: TransportBoamp = transportParDefaut,
  motsCles?: readonly string[],
): Promise<MarchePublic[]> {
  const config = configBoamp();
  const dep = requete.departement ?? departementBoamp(requete.codePostal ?? null);
  // Sans département exploitable, on ne demande RIEN plutôt que de demander
  // la France entière : un avis de l'autre bout du pays n'est pas un signal,
  // c'est du bruit. La Corse passe par ici (voir `departementBoamp`).
  if (!dep) return [];

  // Le paramètre `q=` séparé est IGNORÉ par cette API — confronté en direct :
  // avec ou sans lui, `total_count` ne bouge pas d'un seul enregistrement. La
  // recherche plein texte réelle passe par `search(champ, "terme")` À
  // L'INTÉRIEUR de `where=`, combiné au filtre de département par un AND.
  let where = `code_departement%3D%22${encodeURIComponent(dep)}%22`;

  /*
   * ── SEULEMENT LES AVIS AUXQUELS ON PEUT ENCORE RÉPONDRE ──────────────────
   * Un avis dont la date limite est passée n'est pas « moins intéressant » :
   * il est INEXPLOITABLE. L'écran en affichait de 2017, 2019 et 2020.
   *
   * La borne passe par `toDateString()`, pas par `toISOString().slice(0, 10)` :
   * c'est une DATE MÉTIER — le jour où se trouve l'artisan — et une garde du
   * dépôt (`period-bounds-timezone-guard`) l'impose. Elle s'est d'ailleurs
   * déclenchée sur la première version de cette ligne, qui découpait un
   * instant UTC. Le test correspondant vérifie la FORME de la borne et non sa
   * valeur, pour ne pas se retourner contre nous au passage de minuit.
   *
   * Ce filtre écarte aussi les enregistrements SANS date limite. Mesuré sur
   * les 100 derniers avis du département 35 : 33 n'en portent pas, dont 27
   * « Résultat de marché » et 4 « Rectificatif » — des marchés déjà attribués
   * et des corrections d'avis, rien à quoi soumissionner. Seuls 2 « Avis de
   * marché » sont perdus, et un avis sans échéance n'est de toute façon pas
   * actionnable.
   */
  where += `%20AND%20datelimitereponse%3E%3Ddate%27${toDateString(new Date())}%27`;

  if (motsCles && motsCles.length > 0) {
    const clause = motsCles
      .map((m) => `search(objet%2C%22${encodeURIComponent(m)}%22)`)
      .join("%20OR%20");
    where += `%20AND%20(${clause})`;
  }

  /*
   * ── LE TRI N'EST PAS UN CONFORT ─────────────────────────────────────────
   * Sans `order_by`, cette API rend sa page dans l'ordre naturel du jeu, soit
   * le plus ANCIEN d'abord : le tout premier enregistrement date de 2015, sur
   * 1 701 268 avis. C'est la cause directe de « rien de récent » à l'écran.
   * On trie par date de parution décroissante — les opportunités nouvelles
   * d'abord, toutes encore ouvertes grâce au filtre ci-dessus.
   */
  const url =
    `${config.baseUrl}/records?where=${where}` +
    `&order_by=dateparution%20DESC&limit=${TAILLE_PAGE}`;

  let reponse: { status: number; texte: string };
  try {
    reponse = await transport(url);
  } catch (err) {
    throw new BoampError(
      `Le BOAMP est injoignable : ${err instanceof Error ? err.message : "erreur réseau"}.`,
    );
  }

  if (reponse.status < 200 || reponse.status >= 300) {
    throw new BoampError(`Le BOAMP a répondu ${reponse.status}.`);
  }

  let brut: unknown;
  try {
    brut = JSON.parse(reponse.texte);
  } catch {
    throw new BoampError("Le BOAMP a répondu autre chose que du JSON.");
  }

  const valide = ReponseBoamp.safeParse(brut);
  if (!valide.success) {
    throw new BoampError(
      `La réponse du BOAMP n'a pas la forme attendue. Champs reçus : ${formeRecue(brut)}. ` +
        `Corrigez le schéma dans lib/boamp.ts — ne devinez pas.`,
    );
  }

  const d = valide.data;
  const lignes = "results" in d ? d.results : d.records;

  return lignes.map((a) => ({
    objet: objetDe(a),
    acheteur: acheteurDe(a),
    cpv: a.cpv ?? [],
    departements: a.code_departement ?? [],
    adresse: a.adresse ?? null,
    dateLimiteReponse: a.datelimitereponse ?? null,
    dateParution: a.dateparution ?? null,
    natureProcedure: a.nature_libelle ?? a.procedure_libelle ?? null,
    source: config.source,
  }));
}
