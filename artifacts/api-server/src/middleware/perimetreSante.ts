/*
 * La limite de périmètre en secteur santé — US-B9.4.
 *
 * ── Pourquoi ICI, dans `biz`, et pas sur quelques routeurs ────────────────
 * Même doctrine que `lectureSeule.ts` : posée dans la chaîne commune, la garde
 * vaut pour les routes actuelles ET pour celles qui n'existent pas encore. Un
 * routeur ajouté demain sans y penser est couvert d'office.
 *
 * La story exige que la limite soit « imposée par la structure même des champs
 * disponibles plutôt que par un simple principe d'usage ». Un contrôle posé
 * routeur par routeur serait précisément un principe d'usage : il tiendrait
 * tant que quelqu'un y pense.
 *
 * ── Le refus ORIENTE ──────────────────────────────────────────────────────
 * Quatrième critère de la story. Un « champ non autorisé » sec se lit comme un
 * défaut du produit ; il faut dire où va cette information. Et le message
 * exclut explicitement ce que nodaq assure — règle 3 bis a : un refus rédigé
 * trop largement attraperait le cœur du métier.
 */
import type { Request, Response, NextFunction } from "express";
import { estSecteurSante, texteLibreInterdit, MESSAGE_ORIENTATION_HDS } from "@nodaq/shared";
import { verticalDuTenant } from "../lib/vertical-tenant.js";

/*
 * L'ORDRE des deux contrôles n'est pas indifférent.
 *
 * On regarde d'ABORD le corps de la requête — c'est gratuit — et on ne lit le
 * secteur du tenant que si un champ visé est effectivement rempli. L'ordre
 * inverse imposerait une lecture en base à CHAQUE requête métier du produit,
 * pour un refus qui concerne une poignée de champs et un seul secteur sur
 * dix-sept.
 */
export async function perimetreSante(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  const champs = texteLibreInterdit(req.path, req.body);
  if (champs.length === 0) { next(); return; }

  const vertical = await verticalDuTenant(req.tenantId!);
  if (!estSecteurSante(vertical)) { next(); return; }

  res.status(422).json({
    error: MESSAGE_ORIENTATION_HDS,
    champsRefuses: champs,
    // Un code stable : l'écran peut l'attraper pour afficher l'orientation
    // autrement qu'en message d'erreur brut.
    code: "PERIMETRE_HORS_HDS",
  });
}

/**
 * Le téléversement libre au Classeur, RATTACHÉ à un patient.
 *
 * Un compte-rendu scanné et accroché au dossier d'un patient est exactement ce
 * que la story veut empêcher — « aucune zone n'accepte de contenu libre non
 * structuré qui permettrait l'entrée de données cliniques par la bande ».
 *
 * Un document d'ENTREPRISE (facture fournisseur, attestation d'assurance)
 * reste téléversable : il n'est rattaché à personne, et l'interdire aurait
 * privé le cabinet de son classeur comptable sans rien protéger.
 */
export async function perimetreSanteClasseur(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  const corps = (req.body ?? {}) as Record<string, unknown>;
  const rattache = (typeof corps["affaireId"] === "string" && corps["affaireId"] !== "")
    || (typeof corps["clientId"] === "string" && corps["clientId"] !== "");
  if (!rattache) { next(); return; }

  const vertical = await verticalDuTenant(req.tenantId!);
  if (!estSecteurSante(vertical)) { next(); return; }

  res.status(422).json({
    error: MESSAGE_ORIENTATION_HDS,
    champsRefuses: ["fichier rattaché à un dossier patient"],
    code: "PERIMETRE_HORS_HDS",
  });
}
