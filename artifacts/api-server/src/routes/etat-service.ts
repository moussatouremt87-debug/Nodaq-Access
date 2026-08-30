/**
 * L'état du service — public, sans session.
 *
 * ── CE QU'ELLE SUPPRIME ─────────────────────────────────────────────────────
 *
 * Une classe entière de demandes : « est-ce en panne, ou c'est moi ? ». Sans
 * réponse à cette question, l'artisan écrit au support, attend, et pendant ce
 * temps ne travaille pas. C'est le meilleur rapport effort/volume de toute la
 * pile de support.
 *
 * ── CE QU'ELLE NE PEUT PAS DIRE, ET IL FAUT LE SAVOIR ───────────────────────
 *
 * Elle est servie PAR l'application qu'elle surveille. Si celle-ci ne répond
 * plus du tout, cette page ne répond plus non plus — et son silence est alors
 * la seule information disponible.
 *
 * C'est pourquoi ElevenLabs héberge la sienne ailleurs (incident.io). La
 * nôtre couvre les pannes PARTIELLES, qui sont les fréquentes : le modèle
 * injoignable, l'envoi de courriel qui échoue, la base qui traîne. Toutes
 * celles rencontrées les 29 et 30/08 étaient de ce genre.
 *
 * ── AUCUNE CONFIGURATION N'EST DIVULGUÉE ────────────────────────────────────
 *
 * La page est publique. Elle dit qu'un service est disponible ou non — jamais
 * quelle variable manque, jamais une adresse, jamais un hôte. Un défaut de
 * configuration ne doit pas devenir une carte du système pour qui la lit.
 */
import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();

export type EtatComposant = "operationnel" | "degrade" | "indisponible";

interface Composant {
  readonly nom: string;
  readonly etat: EtatComposant;
  /** Dit à l'utilisateur ce qu'il PEUT encore faire, pas ce qui est cassé. */
  readonly consequence: string | null;
  readonly tempsReponseMs?: number;
}

/** Au-delà, la base répond mais l'application traîne : c'est déjà un incident. */
const SEUIL_BASE_MS = 800;

async function verifierBase(): Promise<Composant> {
  const t0 = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    const ms = Date.now() - t0;
    return {
      nom: "Base de données",
      etat: ms > SEUIL_BASE_MS ? "degrade" : "operationnel",
      consequence: ms > SEUIL_BASE_MS ? "L'application peut être lente." : null,
      tempsReponseMs: ms,
    };
  } catch {
    return {
      nom: "Base de données",
      etat: "indisponible",
      consequence: "Rien ne peut être enregistré ni consulté pour le moment.",
    };
  }
}

/**
 * Le modèle n'est PAS appelé pour vérifier son état.
 *
 * Une page d'état publique appelée à chaque visite déclencherait autant
 * d'appels facturés, et offrirait à quiconque un moyen de les provoquer. On
 * rapporte donc si la sortie est configurée — ce qui distingue « le service
 * n'est pas monté » de « le modèle a eu un incident », et c'est déjà l'essentiel.
 */
function verifierModele(): Composant {
  const configure = Boolean(process.env["LLM_BASE_URL"]?.trim() && process.env["LLM_API_KEY"]?.trim());
  return {
    nom: "Assistant et aide",
    etat: configure ? "operationnel" : "indisponible",
    consequence: configure
      ? null
      : "L'assistant ne répond pas. Le reste de l'application fonctionne normalement.",
  };
}

function verifierEnvoi(): Composant {
  const smtp = Boolean(
    process.env["SMTP_HOST"]?.trim() && process.env["SMTP_USER"]?.trim() && process.env["SMTP_PASS"],
  );
  return {
    nom: "Envoi des documents et des codes",
    etat: smtp ? "operationnel" : "indisponible",
    consequence: smtp
      ? null
      : "Les devis, factures et codes de connexion ne partent pas. "
        + "Si vous êtes déjà connecté, vous pouvez continuer à travailler.",
  };
}

/** Le pire des composants donne l'état d'ensemble — jamais une moyenne. */
function etatGlobal(composants: readonly Composant[]): EtatComposant {
  if (composants.some((c) => c.etat === "indisponible")) return "indisponible";
  if (composants.some((c) => c.etat === "degrade")) return "degrade";
  return "operationnel";
}

export const MESSAGE_GLOBAL: Record<EtatComposant, string> = {
  operationnel: "Tous les services fonctionnent normalement.",
  degrade: "Un service fonctionne au ralenti. L'application reste utilisable.",
  indisponible: "Un service est interrompu. Le détail est indiqué ci-dessous.",
};

router.get("/etat", async (_req, res): Promise<void> => {
  const composants = [await verifierBase(), verifierModele(), verifierEnvoi()];
  const global = etatGlobal(composants);
  // Jamais de cache : une page d'état lue depuis un cache est un mensonge daté.
  res.set("Cache-Control", "no-store");
  res.status(200).json({
    global,
    message: MESSAGE_GLOBAL[global],
    composants,
    verifieLe: new Date().toISOString(),
    // Dit franchement ce que cette page ne peut pas voir.
    limite:
      "Cette page est servie par l'application. Si elle ne s'affiche pas du tout, "
      + "c'est que l'application entière est interrompue.",
  });
});

export default router;
