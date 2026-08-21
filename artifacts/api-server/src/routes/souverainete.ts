/**
 * Attestation de souveraineté des données — US-A7.4.
 *
 * L'artisan qui répond à un marché public avec clause de souveraineté doit
 * prouver à son donneur d'ordre où vont ses données. Jusqu'ici il fallait
 * écrire au support. Ici il télécharge, seul, un document daté.
 *
 * ── Le document REFUSE de mentir ─────────────────────────────────────────
 * Avant d'imprimer quoi que ce soit, on compare l'hôte réellement configuré
 * pour la sortie modèle à celui que `SOUS_TRAITANTS` déclare. Divergence →
 * 409, aucun PDF. Voir `divergencesSouverainete` pour le raisonnement : une
 * attestation qui se « met à jour toute seule » imprimerait sans broncher
 * n'importe quelle nouvelle destination ; celle-ci disparaît d'abord.
 *
 * ── Aucun secret dans le document ────────────────────────────────────────
 * On imprime l'HÔTE d'un service, jamais l'URL complète, jamais une clé
 * (règle 6 du CLAUDE.md). Un document destiné à circuler chez un tiers est
 * exactement le pire endroit où une chaîne de connexion pourrait finir.
 */
import { Router, type IRouter } from "express";
import PDFDocument from "pdfkit";
import { getConfig, LlmConfigError } from "@nodaq/llm";
import {
  SOUS_TRAITANTS,
  SOUVERAINETE_VERSION,
  divergencesSouverainete,
  hoteDeUrl,
  messageRefusAttestation,
} from "@nodaq/shared";
import { loadSellerInfo } from "../lib/seller-info.js";

const router: IRouter = Router();

/**
 * Les URL configurées pour chaque service déclaré. Lues ICI et nulle part
 * ailleurs : la comparaison elle-même reste pure, côté `@nodaq/shared`.
 *
 * `getConfig()` plutôt qu'une lecture directe de `process.env` — c'est la
 * MÊME résolution que celle qu'emprunte le trafic modèle. Constater
 * autrement que le produit ne se comporte reviendrait à attester d'un
 * chemin que personne ne prend.
 */
function urlsConfigurees(): Record<string, string | undefined> {
  return {
    LLM_BASE_URL: getConfig().baseUrl,
    TEM_BASE_URL: process.env["TEM_BASE_URL"],
  };
}

// ── GET /souverainete/attestation ────────────────────────────────────────

router.get("/souverainete/attestation", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  let urls: Record<string, string | undefined>;
  try {
    urls = urlsConfigurees();
  } catch (err) {
    if (err instanceof LlmConfigError) {
      res.status(503).json({
        error:
          "La configuration du service de modèle est incomplète : l'attestation ne peut pas constater où va le traitement, elle n'est donc pas produite.",
      });
      return;
    }
    throw err;
  }

  const divergences = divergencesSouverainete(urls);
  if (divergences.length > 0) {
    res.status(409).json({ error: messageRefusAttestation(divergences) });
    return;
  }

  const seller = await loadSellerInfo(tenantId);
  const emisLe = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    bufferPages: true,
    info: { Title: `Attestation de souveraineté des données — ${seller.nom}` },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="attestation-souverainete-${SOUVERAINETE_VERSION}.pdf"`,
  );
  doc.pipe(res);

  const L = 50;
  const LARGEUR = 495;
  let y = 50;

  const saut = (h: number) => {
    if (y + h > 780) {
      doc.addPage();
      y = 50;
    }
  };

  const titre = (texte: string) => {
    saut(30);
    y += 8;
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#0a0a0a").text(texte, L, y, { width: LARGEUR });
    y += 18;
    doc.moveTo(L, y).lineTo(L + LARGEUR, y).strokeColor("#e0e0e0").lineWidth(1).stroke();
    y += 8;
  };

  const paragraphe = (texte: string, couleur = "#222") => {
    const h = doc.fontSize(9).font("Helvetica").heightOfString(texte, { width: LARGEUR });
    saut(h + 6);
    doc.fontSize(9).font("Helvetica").fillColor(couleur).text(texte, L, y, { width: LARGEUR });
    y += h + 6;
  };

  const champ = (label: string, valeur: string) => {
    const h = doc.fontSize(9).font("Helvetica").heightOfString(valeur, { width: LARGEUR - 130 });
    saut(h + 4);
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#555").text(label, L, y, { width: 125 });
    doc.fontSize(9).font("Helvetica").fillColor("#111").text(valeur, L + 130, y, { width: LARGEUR - 130 });
    y += Math.max(h, 12) + 4;
  };

  // ── En-tête ────────────────────────────────────────────────────────────
  doc.fontSize(20).font("Helvetica-Bold").fillColor("#0a0a0a").text("NODAQ", L, y);
  doc.fontSize(8).font("Helvetica").fillColor("#999")
    .text(`Émise le ${emisLe} — registre version ${SOUVERAINETE_VERSION}`, L, y + 6, {
      align: "right",
      width: LARGEUR,
    });
  y += 30;
  doc.fontSize(15).font("Helvetica-Bold").fillColor("#0a0a0a")
    .text("Attestation de souveraineté des données", L, y, { width: LARGEUR });
  y += 26;
  doc.moveTo(L, y).lineTo(L + LARGEUR, y).strokeColor("#0a0a0a").lineWidth(1.5).stroke();
  y += 12;

  // ── Titulaire ──────────────────────────────────────────────────────────
  titre("Titulaire du compte");
  champ("Entreprise", seller.nom);
  if (seller.siret) champ("SIRET", seller.siret);
  const adresse = [seller.adresse, [seller.codePostal, seller.ville].filter(Boolean).join(" ")]
    .filter((p) => p && p.trim())
    .join(", ");
  if (adresse) champ("Adresse", adresse);

  // ── Objet ──────────────────────────────────────────────────────────────
  titre("Objet");
  paragraphe(
    "Ce document énonce, à la date d'émission, où sont hébergées les données du compte ci-dessus " +
      "et quels sous-traitants interviennent dans leur traitement. Il est généré à partir de la " +
      "configuration réellement en vigueur : il n'est pas rédigé à l'avance et ne peut donc pas " +
      "décrire une architecture qui aurait changé depuis.",
  );

  // ── Sous-traitants ─────────────────────────────────────────────────────
  titre("Sous-traitants intervenant dans le traitement");
  for (const st of SOUS_TRAITANTS) {
    const observe = st.variableEnv ? hoteDeUrl(urls[st.variableEnv]) : undefined;

    saut(60);
    doc.fontSize(9.5).font("Helvetica-Bold").fillColor("#111").text(st.role, L, y, { width: LARGEUR });
    y += 14;
    champ("Prestataire", st.nom ?? "Défini par la configuration de l'exploitant (voir hôte ci-dessous)");
    champ("Localisation déclarée", [st.pays, st.region].filter(Boolean).join(" — "));
    if (st.variableEnv) {
      champ(
        "Hôte constaté",
        observe ?? "aucune destination configurée — aucun transfert vers ce type de service",
      );
    }
    champ("Données concernées", st.donnees);
    champ("Source", st.source);
    y += 6;
  }

  // ── Vérifié vs déclaré ─────────────────────────────────────────────────
  titre("Ce qui est vérifié, ce qui est déclaré");
  paragraphe(
    "VÉRIFIÉ À L'ÉMISSION — les hôtes listés ci-dessus sous « Hôte constaté » ont été lus dans la " +
      "configuration au moment où ce document a été produit. Pour le traitement par modèle de " +
      "langage, l'hôte constaté a de plus été comparé à celui que l'éditeur déclare : en cas " +
      "d'écart, ce document n'est pas produit du tout.",
  );
  paragraphe(
    "DÉCLARÉ PAR L'ÉDITEUR — la localisation physique (pays, région) ne peut pas être prouvée " +
      "depuis l'application elle-même. Elle relève des engagements contractuels de l'éditeur et " +
      "de ses propres sous-traitants.",
  );

  // ── Portée ─────────────────────────────────────────────────────────────
  titre("Portée et limites");
  paragraphe(
    "Ce document n'est pas un accord de sous-traitance et ne s'y substitue pas. Il ne revendique " +
      "aucune certification (notamment ni HDS, ni SecNumCloud) et ne vaut pas conseil juridique. " +
      "Il ne contient volontairement aucun identifiant technique, aucune adresse complète de " +
      "service et aucune clé d'accès.",
    "#555",
  );
  paragraphe(
    "Il décrit un état à une date. Une nouvelle attestation doit être produite pour toute date " +
      "postérieure à celle portée en en-tête.",
    "#555",
  );

  doc.end();
});

export default router;
