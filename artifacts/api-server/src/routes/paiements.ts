/**
 * Journal des paiements.
 *
 * APPEND-ONLY, imposé par le moteur : `app_user` n'a que SELECT et INSERT.
 * Une erreur se corrige par une écriture INVERSE (`sens = 'REMBOURSEMENT'`),
 * jamais par un UPDATE. Cette route n'expose donc ni PATCH ni DELETE — non par
 * oubli, mais parce que la base les refuserait.
 *
 * Un acompte encaissé AVANT toute facture est un paiement avec `factureId` nul
 * et `affaireId` renseigné. C'est le cas courant sur un chantier.
 */
import { Router, type IRouter } from "express";
import { and, eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import {
  withTenant,
  paiementsTable,
  facturesTable,
  SENS_PAIEMENT,
  MOYENS_PAIEMENT,
  NATURES_PAIEMENT,
} from "@workspace/db";
import { toDateString } from "@nodaq/shared";
import { recalculerFacture } from "../lib/reglement-facture.js";

const router: IRouter = Router();

const DATE_METIER = /^\d{4}-\d{2}-\d{2}$/;

const PaiementBody = z.object({
  clientId: z.string().min(1).nullable().optional(),
  factureId: z.string().min(1).nullable().optional(),
  affaireId: z.string().min(1).nullable().optional(),
  /**
   * Date MÉTIER. Le défaut est le jour LOCAL — jamais `toISOString`, qui
   * rangerait un règlement du 1er janvier à 00 h 30 sur l'exercice précédent.
   */
  date: z.string().regex(DATE_METIER, "Date attendue au format AAAA-MM-JJ").optional(),
  montantCents: z.number().int().positive("Le montant doit être strictement positif"),
  sens: z.enum(SENS_PAIEMENT).default("ENCAISSEMENT"),
  moyen: z.enum(MOYENS_PAIEMENT).default("AUTRE"),
  nature: z.enum(NATURES_PAIEMENT).default("AUTRE"),
  reference: z.string().max(140).nullable().optional(),
});

router.get("/paiements", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const filtres = z
    .object({ factureId: z.string().optional(), affaireId: z.string().optional() })
    .safeParse(req.query);
  if (!filtres.success) { res.status(400).json({ error: filtres.error.message }); return; }

  const paiements = await withTenant(tenantId, (tx) => {
    const conditions = [
      ...(filtres.data.factureId ? [eq(paiementsTable.factureId, filtres.data.factureId)] : []),
      ...(filtres.data.affaireId ? [eq(paiementsTable.affaireId, filtres.data.affaireId)] : []),
    ];
    const q = tx.select().from(paiementsTable);
    return conditions.length > 0
      ? q.where(and(...conditions)).orderBy(desc(paiementsTable.date))
      : q.orderBy(desc(paiementsTable.date));
  });

  // Total NET : les remboursements se retranchent. Sommer les montants bruts
  // afficherait un encaissement qui n'a pas eu lieu.
  const totalCents = paiements.reduce(
    (acc, p) => acc + (p.sens === "ENCAISSEMENT" ? p.montantCents : -p.montantCents),
    0,
  );
  res.json({ paiements, total: paiements.length, totalCents });
});

router.post("/paiements", async (req, res): Promise<void> => {
  const parsed = PaiementBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const d = parsed.data;

  const resultat = await withTenant(tenantId, async (tx) => {
    if (d.factureId) {
      const [f] = await tx.select().from(facturesTable).where(eq(facturesTable.id, d.factureId));
      if (!f) return { kind: "facture_introuvable" as const };
    }

    const [paiement] = await tx
      .insert(paiementsTable)
      .values({
        tenantId,
        clientId: d.clientId ?? null,
        factureId: d.factureId ?? null,
        affaireId: d.affaireId ?? null,
        date: d.date ?? toDateString(new Date()),
        montantCents: d.montantCents,
        sens: d.sens,
        moyen: d.moyen,
        nature: d.nature,
        reference: d.reference ?? null,
      })
      .returning();

    // Recalcul DANS la même transaction : un échec ne doit pas laisser un
    // paiement enregistré sur une facture dont l'état n'a pas suivi.
    const etat = d.factureId ? await recalculerFacture(tx, d.factureId) : null;
    return { kind: "ok" as const, paiement: paiement!, etat };
  });

  if (resultat.kind === "facture_introuvable") {
    res.status(404).json({ error: "Facture introuvable" });
    return;
  }
  res.status(201).json({ paiement: resultat.paiement, facture: resultat.etat });
});

/** Total encaissé sur une affaire — acomptes compris, facturés ou non. */
router.get("/affaires/:id/encaisse", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;

  const rows = await withTenant(tenantId, async (tx) => {
    const res2 = await tx.execute(sql`
      SELECT coalesce(sum(
        CASE WHEN sens = 'ENCAISSEMENT' THEN montant_cents ELSE -montant_cents END
      ), 0)::int AS total
      FROM paiements
      WHERE affaire_id = ${id}
    `);
    return (res2 as unknown as { rows: Array<{ total: number }> }).rows;
  });

  res.json({ affaireId: id, encaisseCents: rows[0]?.total ?? 0 });
});

export default router;
