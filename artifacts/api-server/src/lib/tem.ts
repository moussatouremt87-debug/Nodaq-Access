/**
 * Enrôlement d'un domaine auprès du service d'envoi transactionnel.
 *
 * ── Ce que ce module remplace ───────────────────────────────────────────────
 * L'écran promettait « nous préparons l'authentification de votre domaine et
 * vous envoyons par e-mail les trois lignes à recopier ». C'était vrai : un
 * humain enrôlait le domaine à la main dans la console du fournisseur, relevait
 * le sélecteur DKIM et sa clé publique, puis les recopiait. Ce geste cesse de
 * tenir vers le dixième client.
 *
 * ── AUCUNE URL DE FOURNISSEUR EN DUR ────────────────────────────────────────
 * `TEM_BASE_URL` vient de la configuration, sans valeur par défaut — même
 * doctrine que `LLM_BASE_URL` (CLAUDE.md §2). Une URL écrite en dur produit du
 * code qui PARAÎT juste et échoue en production, d'autant plus que les tests,
 * qui simulent le transport, resteraient verts.
 *
 * ── LE TRANSPORT EST INJECTÉ ────────────────────────────────────────────────
 * Comme le résolveur DNS de `parametres-envoi.ts`. Aucun test n'atteint le
 * réseau, et le module s'éprouve sur des réponses construites à la main.
 *
 * ── CE QUI N'A PAS PU ÊTRE VÉRIFIÉ ──────────────────────────────────────────
 * La FORME EXACTE de la réponse du fournisseur n'a pas pu être confrontée au
 * service réel : il n'y a ni clé ni accès réseau ici. Le schéma ci-dessous
 * accepte plusieurs formes plausibles et REFUSE bruyamment tout le reste — il
 * ne devine jamais. Au premier appel réel, si la forme diffère, le message
 * d'erreur dit précisément ce qui a été reçu (sans la clé), et il n'y a qu'un
 * schéma à corriger.
 *
 * Refuser est le bon comportement : un enrôlement qu'on croirait réussi
 * laisserait l'artisan publier un DKIM inexistant et ses devis partir en
 * indésirables — la panne la plus coûteuse de ce produit.
 */
import { z } from "zod";

/** Configuration absente ou inexploitable. La route rend 503, jamais 500. */
export class TemConfigError extends Error {
  constructor(
    message: string,
    readonly variableManquante: string,
  ) {
    super(message);
    this.name = "TemConfigError";
  }
}

/** L'enrôlement a été tenté et a échoué. Le chemin manuel reste ouvert. */
export class TemEnrolementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemEnrolementError";
  }
}

/** Le transport HTTP, injectable. Aucun test n'atteint le réseau. */
export type TransportTem = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; texte: string }>;

const transportParDefaut: TransportTem = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, texte: await r.text() };
};

export interface ConfigTem {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly projetId: string | null;
}

/**
 * Lit la configuration. Lève `TemConfigError` dès qu'il manque quelque chose —
 * aucune valeur par défaut, et la clé n'apparaît dans aucun message.
 */
export function configTem(): ConfigTem {
  const baseUrl = process.env["TEM_BASE_URL"]?.trim();
  if (!baseUrl) {
    throw new TemConfigError(
      "TEM_BASE_URL n'est pas configurée : l'enrôlement automatique du domaine est indisponible.",
      "TEM_BASE_URL",
    );
  }
  const apiKey = process.env["TEM_API_KEY"]?.trim();
  if (!apiKey) {
    throw new TemConfigError(
      "TEM_API_KEY n'est pas configurée : l'enrôlement automatique du domaine est indisponible.",
      "TEM_API_KEY",
    );
  }
  const projetId = process.env["TEM_PROJECT_ID"]?.trim() ?? null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, projetId };
}

// ── La réponse du fournisseur ────────────────────────────────────────────────

/**
 * Formes ACCEPTÉES pour le couple sélecteur / clé publique DKIM.
 *
 * Plusieurs sont admises parce que la forme réelle n'a pas pu être vérifiée ;
 * aucune n'est devinée à l'exécution. Ce qui ne correspond à aucune est refusé.
 */
const ReponseDomaine = z.union([
  z.object({
    dkim_config: z.object({
      selector: z.string().min(1),
      public_key: z.string().min(1),
    }),
  }),
  z.object({
    dkim: z.object({
      selector: z.string().min(1),
      public_key: z.string().min(1),
    }),
  }),
  z.object({
    dkim_selector: z.string().min(1),
    dkim_public_key: z.string().min(1),
  }),
]);

export interface DomaineEnrole {
  readonly selecteur: string;
  readonly valeur: string;
}

/** Extrait le couple, quelle que soit la forme acceptée. */
function extraire(brut: unknown): DomaineEnrole | null {
  const r = ReponseDomaine.safeParse(brut);
  if (!r.success) return null;
  const d = r.data;
  if ("dkim_config" in d) return { selecteur: d.dkim_config.selector, valeur: d.dkim_config.public_key };
  if ("dkim" in d) return { selecteur: d.dkim.selector, valeur: d.dkim.public_key };
  return { selecteur: d.dkim_selector, valeur: d.dkim_public_key };
}

/**
 * Résume une réponse inattendue SANS en recracher le contenu.
 *
 * On rend les NOMS des champs de premier niveau, pas leurs valeurs : c'est ce
 * qu'il faut pour corriger le schéma, et une réponse d'API peut porter des
 * jetons ou des identifiants qui n'ont rien à faire dans un journal.
 */
function formeRecue(brut: unknown): string {
  if (brut === null || typeof brut !== "object") return typeof brut;
  return Object.keys(brut as Record<string, unknown>).sort().join(", ") || "(objet vide)";
}

/**
 * Enrôle un domaine et rend le sélecteur DKIM et sa clé PUBLIQUE.
 *
 * La clé rendue est PUBLIQUE — elle est destinée à être publiée dans le DNS.
 * Aucune clé privée ne transite par ce produit : la signature est faite par le
 * fournisseur.
 */
export async function enrolerDomaine(
  domaine: string,
  transport: TransportTem = transportParDefaut,
): Promise<DomaineEnrole> {
  const config = configTem();

  let reponse: { status: number; texte: string };
  try {
    reponse = await transport(`${config.baseUrl}/domains`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // La clé ne sort d'ici que vers l'en-tête. Elle n'est jamais
        // journalisée, ni incluse dans un message d'erreur.
        "X-Auth-Token": config.apiKey,
      },
      body: JSON.stringify({
        domain_name: domaine,
        ...(config.projetId ? { project_id: config.projetId } : {}),
      }),
    });
  } catch (err) {
    throw new TemEnrolementError(
      `Le service d'envoi est injoignable : ${err instanceof Error ? err.message : "erreur réseau"}.`,
    );
  }

  if (reponse.status < 200 || reponse.status >= 300) {
    // Le CODE, jamais le corps : une réponse d'erreur d'API peut refléter la
    // requête, en-têtes compris.
    throw new TemEnrolementError(
      `Le service d'envoi a refusé l'enrôlement de « ${domaine} » (code ${reponse.status}).`,
    );
  }

  let brut: unknown;
  try {
    brut = JSON.parse(reponse.texte);
  } catch {
    throw new TemEnrolementError("Le service d'envoi a répondu autre chose que du JSON.");
  }

  const extrait = extraire(brut);
  if (!extrait) {
    // On REFUSE plutôt que de deviner. Un enrôlement qu'on croirait réussi
    // ferait publier un DKIM inexistant, et les devis partiraient en
    // indésirables sans que personne comprenne.
    throw new TemEnrolementError(
      `La réponse du service d'envoi n'a pas la forme attendue : le sélecteur DKIM ` +
        `et sa clé publique sont introuvables. Champs reçus : ${formeRecue(brut)}. ` +
        `Corrigez le schéma dans lib/tem.ts — ne devinez pas la valeur.`,
    );
  }
  return extrait;
}
