/**
 * `requireAppelVocal` — authentifie le worker vocal, et lui seul.
 *
 * Le worker est une machine : pas de session, pas de cookie. Il présente le
 * jeton frappé pour l'appel qu'il est en train de passer, et ce jeton fait deux
 * choses à la fois — il l'authentifie, et il DÉSIGNE l'appel.
 *
 * C'est le point important. `req.tenantId` est posé depuis la ligne trouvée en
 * base, jamais depuis le corps ni depuis un en-tête : le worker n'a aucun moyen
 * de nommer un tenant, donc aucun moyen de se tromper de tenant. La règle 1 du
 * CLAUDE.md est tenue par construction et non par vigilance.
 *
 * Il occupe la place que `requireAuth → resolveTenant → requireMembership`
 * occupe pour un humain, et rend le même contrat : `req.tenantId` renseigné,
 * ou 401.
 *
 * ── Ce qu'il n'accorde PAS ────────────────────────────────────────────────
 * Rien d'autre que l'appel en cours. Le jeton cesse de valoir dès que l'appel
 * quitte `PLANIFIE`/`EN_COURS` (la policy l'exige), et il ne donne accès à
 * aucune autre route que celles montées derrière ce middleware. Un jeton fuité
 * ouvre une conversation, pas un portefeuille.
 */
import type { Request, Response, NextFunction } from "express";
import { resoudreAppelParJeton } from "../lib/jeton-appel.js";
import { logger } from "../lib/logger.js";

/** LA réponse d'échec. Une seule, pour ne rien révéler par la différence. */
const REFUS = { error: "Jeton d'appel invalide ou expiré." } as const;

function jetonPresente(req: Request): string | null {
  const brut = req.headers.authorization;
  if (typeof brut !== "string") return null;
  const [schema, valeur] = brut.split(" ");
  if (schema?.toLowerCase() !== "bearer" || !valeur) return null;
  return valeur;
}

export async function requireAppelVocal(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const jeton = jetonPresente(req);
  if (!jeton) {
    res.status(401).json(REFUS);
    return;
  }

  let appel;
  try {
    appel = await resoudreAppelParJeton(jeton);
  } catch (err) {
    // Le jeton ne doit JAMAIS entrer dans un journal, même tronqué (règle 6) :
    // on consigne l'échec, pas ce qui a été présenté.
    logger.error(
      { err: err instanceof Error ? err.message : "erreur" },
      "[appel-vocal] résolution du jeton impossible",
    );
    res.status(503).json({ error: "Résolution impossible." });
    return;
  }

  if (!appel) {
    // Jeton inconnu, appel terminé, ligne effacée pour l'article 17 : une
    // seule et même réponse. Distinguer les cas confirmerait à un curieux
    // qu'un jeton a existé.
    res.status(401).json(REFUS);
    return;
  }

  req.tenantId = appel.tenantId;
  req.appelVocal = { appelId: appel.appelId, campagneId: appel.campagneId };
  next();
}
