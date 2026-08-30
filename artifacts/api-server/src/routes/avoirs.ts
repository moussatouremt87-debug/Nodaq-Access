/**
 * Avoirs (credit notes) — document distinct lié à une facture EMISE.
 * Séquence propre AVOIR-YYYY-NNNN.
 *
 * Atomicity guarantees:
 *   TX1 — conditional UPDATE on the invoice row (Drizzle query builder, respects RLS):
 *     a) validates statut = EMISE and residualCents >= avoirTTC atomically;
 *     b) decrements residualCents;
 *     c) assigns the avoir sequence number (SELECT FOR UPDATE on facture_sequences);
 *     d) sets ANNULEE_PAR_AVOIR + avoirId if residual reaches 0.
 *   PDF generation happens outside TX1 (slow I/O).
 *   TX2 — avoir insert + activity log.  On failure: compensating UPDATE restores invoice.
 *
 * Because the residual guard is embedded in the TX1 UPDATE WHERE clause, concurrent
 * requests that collectively would exceed the residual are serialized by PostgreSQL's
 * implicit row lock: the second UPDATE finds residual already decremented and 0 rows.
 */
import { Router, type IRouter } from "express";
import { withTenant, facturesTable, activityTable, avoirsTable, archivedPdfsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { toDateString } from "@nodaq/shared";
import {
  archiveFacturxPdf,
  buildFacturxInvoice,
  readArchivedPdf,
  type FactureForPdf,
  type FactureLine,
} from "../lib/pdf-generation.js";
import { loadSellerInfo } from "../lib/seller-info.js";
import { enregistrerIncidentAvoirCompensationEchouee } from "../lib/incidents-facturation.js";
import { indexerAuClasseur, nomAuClasseur } from "../lib/indexation-classeur.js";

const router: IRouter = Router();

/** SQLSTATE d'une violation Postgres à travers l'enveloppe Drizzle, ou `null`. */
function sqlstateDe(err: unknown): string | null {
  let courant: unknown = err;
  for (let i = 0; courant !== null && courant !== undefined && i < 5; i++) {
    const code = (courant as { code?: string }).code;
    if (typeof code === "string") return code;
    courant = (courant as { cause?: unknown }).cause;
  }
  return null;
}

const CreateAvoirBody = z.object({
  factureRefId: z.string().min(1, "ID de la facture obligatoire"),
  montantHtCents: z.number().int().positive("Le montant HT de l'avoir doit être positif"),
  montantTvaCents: z.number().int().nonnegative().default(0),
  motif: z.string().min(1, "Le motif de l'avoir est obligatoire"),
});

/** Assign the next avoir sequence number within an existing transaction. */
async function assignAvoirNumero(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  year: number,
): Promise<string> {
  // Avoirs use a negative year key so they share the sequences table without
  // colliding with FACT numbers (which use positive years).
  const avoirYear = -year;
  await tx.execute(
    sql`INSERT INTO facture_sequences (tenant_id, year, seq)
        VALUES (${tenantId}::uuid, ${avoirYear}, 0)
        ON CONFLICT (tenant_id, year) DO NOTHING`,
  );
  const res = await tx.execute(
    sql`SELECT seq FROM facture_sequences
        WHERE tenant_id = ${tenantId}::uuid AND year = ${avoirYear}
        FOR UPDATE`,
  );
  const rows = (res as unknown as { rows: Array<{ seq: number }> }).rows;
  const newSeq = (rows[0]?.seq ?? 0) + 1;
  await tx.execute(
    sql`UPDATE facture_sequences SET seq = ${newSeq}
        WHERE tenant_id = ${tenantId}::uuid AND year = ${avoirYear}`,
  );
  return `AVOIR-${year}-${String(newSeq).padStart(4, "0")}`;
}

router.get("/avoirs", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const avoirs = await withTenant(tenantId, tx =>
    tx.select().from(avoirsTable).orderBy(avoirsTable.createdAt),
  );
  res.json({ avoirs, total: avoirs.length });
});

router.get("/avoirs/:id", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const [avoir] = await withTenant(tenantId, tx =>
    tx.select().from(avoirsTable).where(eq(avoirsTable.id, req.params["id"] as string)),
  );
  if (!avoir) { res.status(404).json({ error: "Avoir introuvable" }); return; }
  res.json(avoir);
});

router.post("/avoirs", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const parsed = CreateAvoirBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const avoirTTC = d.montantHtCents + d.montantTvaCents;

  const seller = await loadSellerInfo(tenantId);
  const now = new Date();
  const issuedDate = toDateString(now);
  const year = now.getFullYear();
  const avoirId = crypto.randomUUID();

  // TX1 — Atomic claim of the invoice residual + sequence assignment.
  //
  // The core guard is the Drizzle UPDATE with `WHERE residualCents >= avoirTTC`.
  // PostgreSQL's implicit row lock on UPDATE means concurrent requests are serialized:
  //   Request A: UPDATE WHERE residual >= X → succeeds, commits residual = old - X
  //   Request B: UPDATE WHERE residual >= X → finds residual = old - X (< X), 0 rows
  //
  // We pre-read the invoice ONLY to build helpful error messages when the UPDATE returns
  // 0 rows — the UPDATE itself is the authoritative validation gate.
  type TX1Result =
    | { kind: "not_found" }
    | { kind: "not_emise"; statut: string }
    | { kind: "already_covered" }
    | { kind: "insufficient_residual"; residual: number }
    /** Chemin « remboursement » : le cumul des avoirs dépasserait le facturé. */
    | { kind: "depasse_total"; dejaRendu: number; total: number }
    | { kind: "ok"; numero: string; oldResidual: number; newResidual: number; isFullCancellation: boolean; facture: typeof facturesTable.$inferSelect };

  let tx1: TX1Result;
  try {
    tx1 = await withTenant(tenantId, async tx => {
      // Pre-read for error diagnostics (not the validation gate).
      const [facture] = await tx.select().from(facturesTable)
        .where(eq(facturesTable.id, d.factureRefId));
      if (!facture) return { kind: "not_found" as const };
      /*
       * ── UN AVOIR APRÈS ENCAISSEMENT EST UN REMBOURSEMENT ─────────────────
       *
       * Sur une facture EMISE, l'avoir réduit ce qui reste DÛ. Sur une facture
       * PAYEE il ne reste rien à réduire : l'avoir devient une somme à rendre.
       * L'invariant change de nature — non plus « ne pas dépasser le solde
       * restant », mais « ne pas rendre plus que ce qui a été facturé ».
       *
       * La facture, elle, RESTE payée : elle l'a été, le journal des
       * encaissements en porte la trace, et la réécrire nierait un fait.
       * L'avoir vit à côté et porte la correction — exactement comme un avoir
       * partiel, où `amount_cents` n'est jamais retouché.
       */
      if (facture.statut === "PAYEE") {
        // Verrou de ligne : deux avoirs concurrents sur la même facture se
        // sérialisent ici, comme le fait le WHERE conditionnel du chemin EMISE.
        await tx.execute(sql`SELECT 1 FROM factures WHERE id = ${d.factureRefId} FOR UPDATE`);
        const cumul = await tx.execute(sql`
          SELECT coalesce(sum(montant_ht_cents + montant_tva_cents), 0)::bigint AS total
            FROM avoirs WHERE facture_ref_id = ${d.factureRefId}
        `);
        const dejaRendu = Number((cumul.rows[0] as { total: string | number }).total);
        if (dejaRendu + avoirTTC > facture.amountCents) {
          return {
            kind: "depasse_total" as const,
            dejaRendu,
            total: facture.amountCents,
          };
        }
        const num = await assignAvoirNumero(tx, tenantId, year);
        return {
          kind: "ok" as const,
          numero: num,
          oldResidual: facture.residualCents ?? 0,
          newResidual: facture.residualCents ?? 0,
          isFullCancellation: false,
          facture,
        };
      }

      if (facture.statut !== "EMISE") return { kind: "not_emise" as const, statut: facture.statut };

      const residualCents = facture.residualCents ?? facture.amountCents;
      if (residualCents <= 0) return { kind: "already_covered" as const };
      if (avoirTTC > residualCents) {
        return { kind: "insufficient_residual" as const, residual: residualCents };
      }

      const newResidual = residualCents - avoirTTC;
      const isFullCancellation = newResidual <= 0;

      // Atomic conditional decrement — the WHERE clause is the concurrent guard.
      // `sql` template in .set() lets us compute residual_cents - X server-side.
      const [claimed] = await tx.update(facturesTable)
        .set({
          residualCents: sql<number>`GREATEST(0, COALESCE(residual_cents, amount_cents) - ${avoirTTC})`,
        })
        .where(and(
          eq(facturesTable.id, d.factureRefId),
          eq(facturesTable.statut, "EMISE"),
          sql`COALESCE(residual_cents, amount_cents) >= ${avoirTTC}`,
        ))
        .returning({ id: facturesTable.id });

      if (!claimed) {
        // A concurrent request must have reduced the residual between our SELECT and
        // this UPDATE. Re-read to give an accurate remaining-residual in the error.
        const [cur] = await tx.select({ residualCents: facturesTable.residualCents, amountCents: facturesTable.amountCents })
          .from(facturesTable).where(eq(facturesTable.id, d.factureRefId));
        const remaining = cur ? (cur.residualCents ?? cur.amountCents) : 0;
        return { kind: "insufficient_residual" as const, residual: remaining };
      }

      // If this is a full cancellation, mark the invoice accordingly.
      if (isFullCancellation) {
        await tx.update(facturesTable)
          .set({ statut: "ANNULEE_PAR_AVOIR", avoirId })
          .where(eq(facturesTable.id, d.factureRefId));
      }

      // Assign avoir sequence number atomically in the same transaction.
      const num = await assignAvoirNumero(tx, tenantId, year);

      return {
        kind: "ok" as const,
        numero: num,
        oldResidual: residualCents,
        newResidual,
        isFullCancellation,
        facture,
      };
    });
  } catch (err) {
    console.error("[avoirs] TX1 error:", err);
    res.status(500).json({ error: "Erreur interne lors de la création de l'avoir. Réessayez." });
    return;
  }

  if (tx1.kind === "not_found") { res.status(404).json({ error: "Facture référencée introuvable" }); return; }
  if (tx1.kind === "not_emise") {
    res.status(422).json({ error: `L'avoir ne peut référencer qu'une facture émise ou payée (statut actuel : ${tx1.statut}).` }); return;
  }
  if (tx1.kind === "depasse_total") {
    res.status(422).json({
      error:
        `Montant de l'avoir TTC (${(avoirTTC / 100).toFixed(2)} €) : le cumul des avoirs ` +
        `(${((tx1.dejaRendu + avoirTTC) / 100).toFixed(2)} €) dépasse le montant facturé ` +
        `(${(tx1.total / 100).toFixed(2)} €). On ne rend pas plus qu'on n'a facturé.`,
    });
    return;
  }
  if (tx1.kind === "already_covered") {
    res.status(409).json({ error: "Cette facture est intégralement couverte par des avoirs. Aucun avoir supplémentaire possible." }); return;
  }
  if (tx1.kind === "insufficient_residual") {
    res.status(422).json({
      error: `Montant de l'avoir TTC (${(avoirTTC / 100).toFixed(2)} €) dépasse le solde résiduel (${(tx1.residual / 100).toFixed(2)} €).`,
    }); return;
  }

  const { numero, oldResidual, isFullCancellation, facture } = tx1;

  // Generate PDF with the real numero. Facture is claimed in DB — undo on failure.
  const lines: FactureLine[] = [{
    id: crypto.randomUUID(),
    description: `Avoir sur facture ${facture.number} — ${d.motif}`,
    quantity: 1,
    unitPriceCents: d.montantHtCents,
    vatRate: d.montantTvaCents > 0 ? Math.round((d.montantTvaCents / d.montantHtCents) * 100) : 0,
    vatCategory: d.montantTvaCents > 0 ? "S" : "Z",
  }];

  const pdfData: FactureForPdf = {
    numero,
    type: "AVOIR",
    issuedDate,
    seller,
    clientName: facture.customerName,
    clientAddress: facture.clientAddress ?? undefined,
    lines,
    autoliquidation: false,
    factureRefNumero: facture.number,
  };

  /**
   * Compense TX1 en restaurant la facture. Si la compensation ÉCHOUE À SON
   * TOUR, la facture reste ANNULEE_PAR_AVOIR (ou son résiduel diminué) sans
   * qu'aucun avoir n'existe — une trace DURABLE est posée, parce qu'une ligne
   * de journal dans un conteneur que personne ne lit ne protège de rien (voir
   * lib/incidents-facturation.ts).
   */
  async function compensateTx1(erreurDeclenchante: unknown): Promise<void> {
    try {
      // Le statut restauré est celui LU avant la transaction, jamais « EMISE »
      // en dur : sur une facture payée, cette constante effaçait l'encaissement
      // au moment même où l'on tentait de réparer.
      await withTenant(tenantId, tx =>
        tx.update(facturesTable)
          .set({ residualCents: oldResidual, avoirId: null, statut: facture.statut })
          .where(eq(facturesTable.id, d.factureRefId)),
      );
    } catch (erreurCompensation) {
      console.error("[avoirs] compensation failed — manual review required for invoice", d.factureRefId);
      await enregistrerIncidentAvoirCompensationEchouee(tenantId, {
        factureId: d.factureRefId,
        factureNumero: facture.number,
        residuelARestaurerCents: oldResidual,
        statutPrecedent: facture.statut,
        numeroAvoirBrule: numero,
        motif: d.motif,
        sqlstateDeclenchant: sqlstateDe(erreurDeclenchante),
        sqlstateCompensation: sqlstateDe(erreurCompensation),
      });
    }
  }

  let pdfBytes: Buffer;
  let pdfSha256: string;
  try {
    const facturxInvoice = buildFacturxInvoice(pdfData, numero);
    const pdf = await archiveFacturxPdf(pdfData, facturxInvoice);
    pdfBytes = pdf.bytes;
    pdfSha256 = pdf.sha256;
  } catch (err) {
    console.error("[avoirs] PDF generation error — compensating TX1:", err);
    await compensateTx1(err);
    res.status(500).json({ error: "Génération du PDF impossible. L'avoir n'a pas été créé." });
    return;
  }

  // TX2 — Insert avoir record + archived PDF + activity log (all atomic).
  // If this transaction fails, no PDF was written to disk, nothing to clean up.
  try {
    const avoir = await withTenant(tenantId, async tx => {
      // Archive PDF bytes atomically with the avoir record.
      await tx.insert(archivedPdfsTable).values({
        id: crypto.randomUUID(),
        tenantId,
        documentType: "AVOIR",
        documentId: avoirId,
        bytes: pdfBytes,
        sha256: pdfSha256,
        byteSize: pdfBytes.length,
      });

      const [created] = await tx.insert(avoirsTable).values({
        id: avoirId,
        tenantId,
        numero,
        factureRefId: d.factureRefId,
        // La même date que celle portée par le PDF. Elle était calculée puis
        // jamais persistée : le CA ne pouvait donc déduire l'avoir que sur
        // `created_at`, un instant, avec le décalage de fuseau qui va avec.
        issuedDate,
        montantHtCents: d.montantHtCents,
        montantTvaCents: d.montantTvaCents,
        motif: d.motif,
        pdfPath: null,   // stored in archived_pdfs
        pdfSha256,
      }).returning();

      await indexerAuClasseur(tx, {
        tenantId, sourceType: "AVOIR", sourceId: created!.id,
        nom: nomAuClasseur("AVOIR", created!.numero, created!.id),
      });

      await tx.insert(activityTable).values({
        tenantId,
        type: "avoir_emis",
        label: `Avoir émis : ${numero} (${isFullCancellation ? "annulation" : "correction partielle"} de ${facture.number})`,
        meta: facture.customerName,
      });

      return created;
    });

    res.status(201).json(avoir);
  } catch (err) {
    console.error("[avoirs] TX2 insert error — compensating:", err);
    // No file on disk to delete — bytes were only in memory.
    await compensateTx1(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de l'avoir. Réessayez." });
  }
});

router.get("/avoirs/:id/pdf", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const avoirId = req.params["id"] as string;

  const [avoir] = await withTenant(tenantId, tx =>
    tx.select().from(avoirsTable).where(eq(avoirsTable.id, avoirId)),
  );
  if (!avoir) { res.status(404).json({ error: "Avoir introuvable" }); return; }

  // Primary source: archived_pdfs table (new path — zero disk dependency).
  const [archived] = await withTenant(tenantId, tx =>
    tx.select().from(archivedPdfsTable).where(
      and(
        eq(archivedPdfsTable.documentType, "AVOIR"),
        eq(archivedPdfsTable.documentId, avoirId),
      ),
    ),
  );

  if (archived) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${avoir.numero}.pdf"`);
    res.setHeader("X-Pdf-Sha256", archived.sha256);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(archived.bytes);
    return;
  }

  // Fallback: disk file for avoirs emitted before the DB-archival migration.
  if (!avoir.pdfPath) { res.status(404).json({ error: "PDF non disponible" }); return; }

  const bytes = readArchivedPdf(avoir.pdfPath);
  if (!bytes) { res.status(404).json({ error: "Fichier PDF introuvable" }); return; }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${avoir.numero}.pdf"`);
  res.setHeader("X-Pdf-Sha256", avoir.pdfSha256 ?? "");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.send(bytes);
});

export default router;
