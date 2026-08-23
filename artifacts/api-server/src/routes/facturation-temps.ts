/**
 * Facturer le temps passé — US-A2.4, et le temps facturable — US-B5.4.
 *
 * ── Ce que l'audit du 23/08 a constaté ────────────────────────────────────
 * Le produit sait POINTER des heures et les analyser ; il ne sait pas les
 * FACTURER. C'est le mode de facturation entier des professions libérales, du
 * conseil et des services aux entreprises.
 *
 * ── Aucune seconde saisie d'heures ────────────────────────────────────────
 * Le point d'attention de la story l'interdit explicitement. Ces routes
 * lisent `pointages` et n'y écrivent rien.
 *
 * ── La facture produite est un BROUILLON ──────────────────────────────────
 * Comme toute création de facture dans ce produit : l'émission scelle un
 * document immuable et consomme un numéro de séquence, elle reste un geste
 * d'écran délibéré. Le brouillon se relit et se corrige avant.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
  withTenant, tauxHorairesTable, pointagesTable, facturesTable, clientsTable, affairesTable,
} from "@workspace/db";
import { lignesDepuisHeures, tauxOccupation, type HeurePointee } from "@nodaq/shared";
import { indexerAuClasseur, nomAuClasseur } from "../lib/indexation-classeur.js";

const router: IRouter = Router();

const DATE_METIER = /^\d{4}-\d{2}-\d{2}$/;

// ═══════════════════════════════════════════════════════════════════════════
// Les taux horaires de facturation
// ═══════════════════════════════════════════════════════════════════════════

const CorpsTaux = z.object({
  dateEffet: z.string().regex(DATE_METIER, "Date attendue au format AAAA-MM-JJ"),
  // En CENTIMES et strictement positif : un taux à zéro ne facture rien et
  // ferait passer du travail réel pour du bénévolat.
  montantCents: z.number().int().positive("Le taux horaire doit être strictement positif"),
  /** Un membre précis, ou l'entreprise entière. */
  membreId: z.string().min(1).nullable().optional(),
}).strict();

router.get("/taux-horaires", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const taux = await withTenant(tenantId, (tx) =>
    tx.select().from(tauxHorairesTable).orderBy(asc(tauxHorairesTable.dateEffet)),
  );
  res.json({ taux });
});

/**
 * Ajoute un taux à l'historique. Ne REMPLACE jamais le précédent.
 *
 * C'est tout l'objet de la story : un taux qui change ne doit pas réécrire le
 * passé. Une facture émise en mars sur des heures de janvier applique le taux
 * de janvier — ce qui n'est possible que si celui-ci existe encore.
 */
router.post("/taux-horaires", async (req, res): Promise<void> => {
  const parsed = CorpsTaux.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const d = parsed.data;

  try {
    const [cree] = await withTenant(tenantId, (tx) =>
      tx.insert(tauxHorairesTable).values({
        tenantId,
        dateEffet: d.dateEffet,
        montantCents: d.montantCents,
        ...(d.membreId ? { membreId: d.membreId } : {}),
      }).returning(),
    );
    res.status(201).json(cree);
  } catch (e) {
    // L'index unique (tenant, date, membre) refuse deux taux le même jour
    // pour la même cible : lequel appliquerait-on ?
    //
    // Le CODE SQLSTATE et non le texte : `withTenant` enveloppe l'erreur du
    // pilote, et le nom de la contrainte n'y survit pas toujours. 23505 est
    // stable, il ne dépend ni de la locale ni de la version.
    // La CHAÎNE des causes, et non le premier niveau : `withTenant` enveloppe
    // l'erreur du pilote, et ni le code SQLSTATE ni le nom de la contrainte
    // ne survivent à l'enveloppe. Vérifié — sans cette remontée, un doublon
    // rendait 500 au lieu de 409.
    const estDoublon = (err: unknown, profondeur = 0): boolean => {
      if (err === null || typeof err !== "object" || profondeur > 5) return false;
      const o = err as { code?: string; message?: string; cause?: unknown };
      if (o.code === "23505") return true;
      if (typeof o.message === "string" && o.message.includes("taux_horaires_effet_idx")) return true;
      return estDoublon(o.cause, profondeur + 1);
    };
    if (estDoublon(e)) {
      res.status(409).json({
        error: "Un taux prend déjà effet à cette date. Corrigez-le plutôt que d'en ajouter un second — sinon rien ne dit lequel s'applique.",
      });
      return;
    }
    throw e;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// La facture au temps passé
// ═══════════════════════════════════════════════════════════════════════════

const CorpsDepuisHeures = z.object({
  du: z.string().regex(DATE_METIER),
  au: z.string().regex(DATE_METIER),
  affaireId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  /** Le taux de TVA appliqué aux lignes. Le tenant le connaît, pas nous. */
  vatRate: z.number().min(0).max(100).default(20),
}).strict().refine((d) => d.du <= d.au, {
  message: "La date de début doit précéder la date de fin",
}).refine((d) => Boolean(d.affaireId) !== Boolean(d.clientId), {
  // Même exclusivité que le pointage lui-même (US-A4.1) : les heures sont
  // rattachées à une affaire OU à un client, jamais aux deux.
  message: "Précisez une affaire OU un client, jamais les deux ni aucun des deux",
});

/**
 * Prépare une facture depuis les heures pointées d'une période.
 *
 * ── Ce qu'elle NE fait pas ────────────────────────────────────────────────
 * Elle n'émet pas, ne marque pas les heures comme facturées, et n'empêche pas
 * une seconde facture sur la même période. Ce dernier point est délibéré :
 * une correction légitime existe, et bloquer forcerait à contourner. En
 * revanche la facture PORTE ses bornes (`heures_du`, `heures_au`), ce qui rend
 * un doublon visible plutôt qu'indétectable.
 */
router.post("/factures/depuis-heures", async (req, res): Promise<void> => {
  const parsed = CorpsDepuisHeures.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const d = parsed.data;

  const resultat = await withTenant(tenantId, async (tx) => {
    const historique = await tx.select().from(tauxHorairesTable);
    if (historique.length === 0) return { kind: "sans_taux" as const };

    const pointages = await tx.select().from(pointagesTable).where(and(
      gte(pointagesTable.date, d.du),
      lte(pointagesTable.date, d.au),
      d.affaireId
        ? eq(pointagesTable.affaireId, d.affaireId)
        : eq(pointagesTable.clientId, d.clientId!),
    ));
    if (pointages.length === 0) return { kind: "sans_heures" as const };

    const heures: HeurePointee[] = pointages.map((p) => ({
      id: p.id, date: p.date,
      // `numeric` en base : le pilote le rend en CHAÎNE, parce que sa plage
      // dépasse ce qu'un `number` représente exactement. Sur des heures — au
      // plus 24 par jour, deux décimales — la conversion est sans perte, et
      // l'omettre ferait concaténer les durées au lieu de les additionner.
      heures: Number(p.heures),
      membreId: p.membreId, facturable: p.facturable,
      commentaire: p.commentaire,
    }));
    const calcul = lignesDepuisHeures(heures, historique.map((t) => ({
      dateEffet: t.dateEffet, montantCents: t.montantCents, membreId: t.membreId,
    })));

    if (calcul.lignes.length === 0) {
      return { kind: "rien_a_facturer" as const, ecartes: calcul.ecartes };
    }

    // Le nom du client : celui de l'affaire, ou celui du client direct.
    let customerName = "Client";
    if (d.affaireId) {
      const [a] = await tx.select().from(affairesTable).where(eq(affairesTable.id, d.affaireId));
      customerName = a?.clientName ?? customerName;
    } else {
      const [c] = await tx.select().from(clientsTable).where(eq(clientsTable.id, d.clientId!));
      customerName = c?.nom ?? customerName;
    }

    const lignes = calcul.lignes.map((l) => ({
      id: crypto.randomUUID(),
      description: l.libelle,
      quantity: l.heures,
      unitPriceCents: l.tauxCents,
      vatRate: d.vatRate,
      vatCategory: "S" as const,
      unit: "h",
    }));
    const totalHTCents = calcul.totalCents;
    const totalTVACents = Math.round((totalHTCents * d.vatRate) / 100);

    const echeance = new Date();
    echeance.setDate(echeance.getDate() + 30);
    const iso = (dt: Date) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

    const [facture] = await tx.insert(facturesTable).values({
      tenantId,
      customerName,
      // Vide : le numéro est attribué à l'ÉMISSION, jamais avant.
      number: "",
      issuedDate: iso(new Date()),
      dueDate: iso(echeance),
      amountCents: totalHTCents + totalTVACents,
      residualCents: totalHTCents + totalTVACents,
      settled: false,
      statut: "BROUILLON",
      lines: lignes,
      totalHTCents,
      totalTVACents,
      autoliquidation: false,
      heuresDu: d.du,
      heuresAu: d.au,
      ...(d.affaireId ? { affaireId: d.affaireId } : {}),
    }).returning();

    await indexerAuClasseur(tx, {
      tenantId, sourceType: "FACTURE", sourceId: facture!.id,
      nom: nomAuClasseur("FACTURE", facture!.number, facture!.id),
      affaireId: facture!.affaireId,
    });

    return {
      kind: "ok" as const, facture,
      totalHeures: calcul.totalHeures,
      // Ce qui n'a PAS été facturé remonte toujours : une facture silencieuse
      // sur du travail écarté est une facture qu'on croit complète.
      ecartes: calcul.ecartes,
      tauxOccupation: tauxOccupation(heures),
    };
  });

  switch (resultat.kind) {
    case "sans_taux":
      res.status(422).json({
        error: "Aucun taux horaire n'est enregistré. Renseignez-en un avant de facturer du temps — sans lui, rien ne dit à quel prix.",
      });
      return;
    case "sans_heures":
      res.status(422).json({ error: "Aucune heure pointée sur cette période." });
      return;
    case "rien_a_facturer":
      res.status(422).json({
        error: "Aucune heure facturable sur cette période.",
        ecartes: resultat.ecartes,
      });
      return;
    case "ok":
      res.status(201).json({
        facture: resultat.facture,
        totalHeures: resultat.totalHeures,
        ecartes: resultat.ecartes,
        tauxOccupation: resultat.tauxOccupation,
      });
  }
});

export default router;
