/**
 * Tiers de confiance en lecture seule — US-A5.4.
 *
 * DEUX gardes, montées ensemble dans la chaîne `biz` (`routes/index.ts`),
 * après `requireMembership` qui vient de relire le rôle en base :
 *
 *   1. `lectureSeuleMethode`  — un `VIEWER` ne peut émettre que des GET.
 *   2. `lectureSeulePerimetre` — un `VIEWER` n'atteint que les chemins de
 *      `ECRANS_TIERS_LECTURE`.
 *
 * ── Pourquoi une garde et non 97 modifications ───────────────────────────
 * Le contrôle de rôle de ce dépôt est PAR ROUTEUR (`requireRole`, composé
 * dans `routes/index.ts`), pas par méthode. Il y a 97 routes mutantes.
 * Appliquer « lecture seule » route par route serait à la fois interminable
 * et faux dès la 98ᵉ : la garde qu'on oublie de poser ne se signale jamais.
 * Posée dans `biz`, celle-ci couvre tout ce qui existe ET tout ce qui
 * viendra, sans que personne ait à y penser.
 *
 * ── Pourquoi une LISTE BLANCHE ───────────────────────────────────────────
 * Le périmètre est un allowlist, pas un denylist. Ajouter un routeur demain
 * sans toucher à cette liste le rend inaccessible au tiers — le mode de
 * défaillance est le refus, pas la fuite. L'inverse (lister ce qui est
 * interdit) ouvrirait silencieusement chaque nouveauté à quelqu'un
 * d'extérieur à l'entreprise. Voir `ECRANS_TIERS_LECTURE` (@nodaq/shared).
 *
 * ── Ce que ces gardes ne couvrent pas, volontairement ─────────────────────
 * `authRouter` et `mfaRouter` sont montés HORS de `biz`. Un `VIEWER` peut
 * donc se déconnecter (`POST /auth/logout`) et faire son enrôlement MFA
 * (`POST /mfa/enroll`, `/mfa/verify`) — tous deux en POST. Sans cette
 * exclusion il serait enfermé dehors : `VIEWER` est dans `FINANCIAL_ROLES`,
 * donc `requireMfaVerified` lui impose le second facteur, qu'il ne pourrait
 * jamais prouver si les gardes ci-dessous s'appliquaient aussi à `/mfa/*`.
 */
import type { Request, Response, NextFunction } from "express";
import { estLectureSeule, cheminOuvertEnLectureSeule } from "@nodaq/shared";

export function lectureSeuleMethode(req: Request, res: Response, next: NextFunction): void {
  if (!estLectureSeule(req.session?.role)) { next(); return; }
  // HEAD et OPTIONS ne modifient rien non plus — les refuser casserait les
  // préconditions CORS sans rien protéger.
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") { next(); return; }
  res.status(403).json({
    error: "Votre accès est en lecture seule — aucune modification n'est possible.",
  });
}

export function lectureSeulePerimetre(req: Request, res: Response, next: NextFunction): void {
  if (!estLectureSeule(req.session?.role)) { next(); return; }
  // `req.path` est relatif au point de montage du routeur (`/api`), donc
  // déjà de la forme `/compte-resultat/...` — la même forme que les préfixes
  // de `ECRANS_TIERS_LECTURE`.
  if (cheminOuvertEnLectureSeule(req.path)) { next(); return; }
  res.status(403).json({
    error: "Cet écran n'est pas inclus dans l'accès qui vous a été ouvert.",
  });
}
