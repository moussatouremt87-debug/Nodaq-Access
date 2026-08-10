/**
 * Factures — conformité légale française.
 *
 * Règles non négociables :
 *   - Une facture EMISE ne se modifie jamais et ne se supprime jamais.
 *   - La numérotation séquentielle est atomique (SELECT FOR UPDATE).
 *   - Le PDF archivé EST le PDF affiché (même SHA-256).
 */
import { Router, type IRouter } from "express";
import { requireRole } from "../middleware/requireRole.js";
import { withTenant, facturesTable, avoirsTable, activityTable, settingsTable, archivedPdfsTable, paiementsTable } from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { auditInvoice } from "@nodaq/facturx";
import { toDateString } from "@nodaq/shared";
import { encaisseSurFacture, recalculerFacture } from "../lib/reglement-facture.js";
import { evaluerFranchissements, messageFranchissement } from "../lib/franchissement-objectifs.js";
import {
  archiveFacturxPdf,
  buildFacturxInvoice,
  readArchivedPdf,
  auditMentionsFR,
  type FactureForPdf,
  type SellerInfo,
  type FactureLine,
  type FactureAddress,
} from "../lib/pdf-generation.js";
import { sendDocument } from "../lib/canal-emission.js";

const router: IRouter = Router();

// ── Zod schemas ──────────────────────────────────────────────────────────────

const AddressSchema = z.object({
  street: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
});

const LineSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  vatRate: z.number().refine(r => [20, 10, 5.5, 2.1, 0].includes(r), {
    message: "Taux TVA doit être 20, 10, 5.5, 2.1 ou 0",
  }).default(20),
  vatCategory: z.enum(["S", "Z", "E", "AE"]).default("S"),
  unit: z.string().optional(),
});

const CreateFactureBody = z.object({
  customerName: z.string().min(1),
  clientAddress: AddressSchema.optional(),
  chantierAddress: AddressSchema.optional(),
  issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date format YYYY-MM-DD"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date format YYYY-MM-DD"),
  lines: z.array(LineSchema).default([]),
  autoliquidation: z.boolean().default(false),
  attestationTvaFournie: z.boolean().default(false),
  affaireId: z.string().optional(),
  notes: z.string().optional(),
});

const UpdateFactureBody = z.object({
  customerName: z.string().min(1).optional(),
  clientAddress: AddressSchema.optional(),
  chantierAddress: AddressSchema.optional(),
  issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: z.array(LineSchema).optional(),
  autoliquidation: z.boolean().optional(),
  attestationTvaFournie: z.boolean().optional(),
  affaireId: z.string().optional(),
  notes: z.string().optional(),
  // Legacy compat
  settled: z.boolean().optional(),
  residualCents: z.number().optional(),
});

const EmettreBody = z.object({
  /** Override due date at emission */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Override issued date (defaults to today) */
  issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Send email after emission */
  sendEmail: z.boolean().default(false),
  emailTo: z.string().email().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeTotals(lines: FactureLine[], autoliquidation: boolean) {
  const totalHTCents = lines.reduce(
    (acc, l) => acc + Math.round(l.quantity * l.unitPriceCents),
    0,
  );
  const totalTVACents = autoliquidation
    ? 0
    : lines.reduce((acc, l) => {
        const base = Math.round(l.quantity * l.unitPriceCents);
        return acc + Math.round((base * (l.vatRate ?? 20)) / 100);
      }, 0);
  const amountCents = totalHTCents + totalTVACents;
  return { totalHTCents, totalTVACents, amountCents };
}

/** Load company settings for a tenant. Returns a SellerInfo. */
async function loadSellerInfo(tenantId: string): Promise<SellerInfo> {
  const rows = await withTenant(tenantId, async tx =>
    tx.select().from(settingsTable).where(
      sql`${settingsTable.tenantId} = ${tenantId}::uuid`,
    ),
  );
  const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    nom: (byKey["company.nom"] as string) ?? "Entreprise",
    formeJuridique: byKey["company.forme_juridique"] as string | undefined,
    siret: (byKey["company.siret"] as string) ?? "",
    tvaIntracom: byKey["company.tva_intracom"] as string | undefined,
    adresse: byKey["company.adresse_rue"] as string | undefined,
    codePostal: byKey["company.adresse_cp"] as string | undefined,
    ville: byKey["company.adresse_ville"] as string | undefined,
    decennaleAssureur: byKey["company.decennale_assureur"] as string | undefined,
    decennaleNumero: byKey["company.decennale_numero"] as string | undefined,
    decennaleCouverture: byKey["company.decennale_couverture"] as string | undefined,
  };
}

/**
 * Assigns the next sequential numero for a facture in a given year.
 * Uses SELECT FOR UPDATE inside the existing withTenant transaction to
 * guarantee no gaps and no duplicates under concurrent emissions.
 *
 * Must be called inside a withTenant callback.
 */
async function assignNextNumero(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  year: number,
  prefix = "FACT",
): Promise<string> {
  // Ensure row exists
  await tx.execute(
    sql`INSERT INTO facture_sequences (tenant_id, year, seq)
        VALUES (${tenantId}::uuid, ${year}, 0)
        ON CONFLICT (tenant_id, year) DO NOTHING`,
  );

  // Lock row exclusively within this transaction
  const res = await tx.execute(
    sql`SELECT seq FROM facture_sequences
        WHERE tenant_id = ${tenantId}::uuid AND year = ${year}
        FOR UPDATE`,
  );
  const rows = (res as unknown as { rows: Array<{ seq: number }> }).rows;
  const newSeq = (rows[0]?.seq ?? 0) + 1;

  await tx.execute(
    sql`UPDATE facture_sequences SET seq = ${newSeq}
        WHERE tenant_id = ${tenantId}::uuid AND year = ${year}`,
  );

  return `${prefix}-${year}-${String(newSeq).padStart(4, "0")}`;
}

// ── Guard: facture must be BROUILLON ─────────────────────────────────────────

async function assertBrouillon(
  tenantId: string,
  id: string,
): Promise<typeof facturesTable.$inferSelect | null> {
  const rows = await withTenant(tenantId, tx =>
    tx.select().from(facturesTable).where(eq(facturesTable.id, id)),
  );
  return rows[0] ?? null;
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get("/factures", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { statut, settled: settledParam } = req.query as Record<string, string>;

  const factures = await withTenant(tenantId, async tx => {
    let q = tx.select().from(facturesTable).$dynamic();
    if (statut) q = q.where(eq(facturesTable.statut, statut));
    return q.orderBy(desc(facturesTable.createdAt));
  });

  const filtered = settledParam !== undefined
    ? factures.filter(f => f.settled === (settledParam === "true"))
    : factures;

  const totalAmountCents = filtered.reduce((acc, f) => acc + (f.amountCents ?? 0), 0);
  const totalOverdueCents = filtered
    .filter(f => f.statut !== "PAYEE" && f.statut !== "ANNULEE_PAR_AVOIR" && new Date(f.dueDate) < new Date())
    .reduce((acc, f) => acc + (f.residualCents ?? f.amountCents ?? 0), 0);

  res.json({ factures: filtered, totalAmountCents, totalOverdueCents });
});

router.post("/factures", async (req, res): Promise<void> => {
  const parsed = CreateFactureBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const tenantId = req.tenantId!;

  const linesWithId: FactureLine[] = d.lines.map(l => ({
    id: l.id ?? crypto.randomUUID(),
    description: l.description,
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    vatRate: l.vatRate,
    vatCategory: l.vatCategory,
    unit: l.unit,
  }));

  const { totalHTCents, totalTVACents, amountCents } = computeTotals(linesWithId, d.autoliquidation);

  const [created] = await withTenant(tenantId, tx =>
    tx.insert(facturesTable).values({
      tenantId,
      customerName: d.customerName,
      number: "",
      issuedDate: d.issuedDate,
      dueDate: d.dueDate,
      amountCents,
      residualCents: amountCents,
      settled: false,
      statut: "BROUILLON",
      lines: linesWithId,
      totalHTCents,
      totalTVACents,
      clientAddress: d.clientAddress as FactureAddress | undefined,
      chantierAddress: d.chantierAddress as FactureAddress | undefined,
      autoliquidation: d.autoliquidation,
      attestationTvaFournie: d.attestationTvaFournie,
      affaireId: d.affaireId,
    }).returning(),
  );

  res.status(201).json(created);
});

router.get("/factures/:id", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  const [f] = await withTenant(tenantId, tx =>
    tx.select().from(facturesTable).where(eq(facturesTable.id, id!)),
  );
  if (!f) { res.status(404).json({ error: "Not found" }); return; }
  res.json(f);
});

/** PATCH — brouillon only. */
router.patch("/factures/:id", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  const parsed = UpdateFactureBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;

  const updated = await withTenant(tenantId, async tx => {
    const [existing] = await tx.select().from(facturesTable).where(eq(facturesTable.id, id!));
    if (!existing) return null;

    // ─── IMMUTABILITÉ ──────────────────────────────────────────────────────
    if (existing.statut === "EMISE" || existing.statut === "ANNULEE_PAR_AVOIR") {
      return { _locked: true as const, statut: existing.statut };
    }

    const linesWithId: FactureLine[] | undefined = d.lines?.map(l => ({
      id: l.id ?? crypto.randomUUID(),
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      vatRate: l.vatRate,
      vatCategory: l.vatCategory,
      unit: l.unit,
    }));

    const lines = linesWithId ?? existing.lines;
    const autoliquidation = d.autoliquidation ?? existing.autoliquidation;
    const { totalHTCents, totalTVACents, amountCents } = computeTotals(lines, autoliquidation);

    const update: Record<string, unknown> = {
      totalHTCents, totalTVACents, amountCents,
      residualCents: amountCents,
      autoliquidation,
      lines,
    };
    if (d.customerName !== undefined) update.customerName = d.customerName;
    if (d.clientAddress !== undefined) update.clientAddress = d.clientAddress;
    if (d.chantierAddress !== undefined) update.chantierAddress = d.chantierAddress;
    if (d.issuedDate !== undefined) update.issuedDate = d.issuedDate;
    if (d.dueDate !== undefined) update.dueDate = d.dueDate;
    if (d.attestationTvaFournie !== undefined) update.attestationTvaFournie = d.attestationTvaFournie;
    if (d.affaireId !== undefined) update.affaireId = d.affaireId;
    if (d.settled !== undefined) { update.settled = d.settled; if (d.settled) update.statut = "PAYEE"; }
    if (d.residualCents !== undefined) update.residualCents = d.residualCents;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [updated] = await tx.update(facturesTable)
      .set(update as any)
      .where(eq(facturesTable.id, id!))
      .returning();
    return updated;
  });

  if (!updated) { res.status(404).json({ error: "Facture introuvable" }); return; }
  if ("_locked" in updated && updated._locked) {
    res.status(409).json({
      error: `Une facture ${updated.statut} est immuable. Toute correction passe par un avoir.`,
    });
    return;
  }
  res.json(updated);
});

/** DELETE — brouillon only, OWNER only. */
router.delete("/factures/:id", requireRole(["OWNER"]), async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const id = req.params["id"] as string;

  const result = await withTenant(tenantId, async tx => {
    const [existing] = await tx.select().from(facturesTable).where(eq(facturesTable.id, id!));
    if (!existing) return "not_found";
    if (existing.statut === "EMISE" || existing.statut === "ANNULEE_PAR_AVOIR") {
      return "locked";
    }
    await tx.delete(facturesTable).where(eq(facturesTable.id, id!));
    return "ok";
  });

  if (result === "not_found") { res.status(404).json({ error: "Facture introuvable" }); return; }
  if (result === "locked") {
    res.status(409).json({ error: "Une facture émise ne peut pas être supprimée. Émettez un avoir." });
    return;
  }
  res.status(204).send();
});

/** POST /api/factures/:id/emettre — assigns numero, generates PDF, locks the facture. */
router.post("/factures/:id/emettre", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  const parsed = EmettreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const opts = parsed.data;

  const issuedDate = opts.issuedDate ?? toDateString(new Date());

  // 1. Load seller info (informational read — not holding a row lock)
  const seller = await loadSellerInfo(tenantId);

  // 2. Pre-flight read for audits: load facture without locking yet
  const [preCheck] = await withTenant(tenantId, tx =>
    tx.select().from(facturesTable).where(eq(facturesTable.id, id!)),
  );
  if (!preCheck) { res.status(404).json({ error: "Facture introuvable" }); return; }
  if (preCheck.statut !== "BROUILLON") {
    res.status(409).json({ error: `Facture déjà ${preCheck.statut} — impossible de réémettre.` });
    return;
  }

  const dueDate = opts.dueDate ?? preCheck.dueDate;
  const lines = preCheck.lines as FactureLine[];

  // 3. Mandatory-mention audit (CPU — happens before we acquire any lock)
  const pdfData: FactureForPdf = {
    numero: "DRAFT",
    type: "FACTURE",
    issuedDate,
    dueDate,
    seller,
    clientName: preCheck.customerName,
    clientAddress: preCheck.clientAddress ?? undefined,
    chantierAddress: preCheck.chantierAddress ?? undefined,
    lines,
    autoliquidation: preCheck.autoliquidation,
    attestationTvaFournie: preCheck.attestationTvaFournie,
  };
  const mentionIssues = auditMentionsFR(pdfData);
  const blockers = mentionIssues.filter(i => i.bloquant);
  if (blockers.length > 0) {
    res.status(422).json({
      error: "Émission bloquée — mentions obligatoires manquantes.",
      issues: blockers.map(i => ({ code: i.code, message: i.message })),
    });
    return;
  }

  // 4. Factur-X pre-audit with a placeholder numero (numero_manquant is excluded
  //    because we don't have the real number yet; all other blockers are real).
  const placeholderFacturx = buildFacturxInvoice(
    { ...pdfData, numero: `FACT-${new Date(issuedDate).getFullYear()}-XXXX` },
    `FACT-${new Date(issuedDate).getFullYear()}-XXXX`,
  );
  const fxPre = auditInvoice(placeholderFacturx);
  const fxBlockers = fxPre.issues.filter(
    i => i.severity === "bloquant"
      && i.code !== "siret_acheteur_invalide"
      && i.code !== "siret_acheteur_manquant"
      && i.code !== "numero_manquant",
  );
  if (fxBlockers.length > 0) {
    res.status(422).json({
      error: "Factur-X audit bloquant.",
      issues: fxBlockers.map(i => ({ code: i.code, reason: i.reason })),
    });
    return;
  }

  const year = new Date(issuedDate).getFullYear();

  // 5. PRE-ASSIGN numero in its own committed transaction.
  //    This runs BEFORE PDF generation so the PDF embeds the real legal number.
  //    If PDF generation subsequently fails, the numero is wasted (gap in sequence)
  //    but the facture stays BROUILLON and the artisan can retry (getting N+1).
  //    A gap is vastly preferable to leaving a legally-emitted invoice without its
  //    required archived PDF.
  let numero: string;
  try {
    numero = await withTenant(tenantId, tx =>
      assignNextNumero(tx, tenantId, year, "FACT"),
    );
  } catch (err) {
    console.error("[factures/emettre] sequence assignment error:", err);
    res.status(500).json({ error: "Impossible d'assigner un numéro. Réessayez." });
    return;
  }

  // 6. Generate PDF bytes with the real numero.
  //    Nothing is written to disk — bytes live in memory until the DB commit below.
  //    If generation fails, the numero is wasted but the facture stays BROUILLON.
  pdfData.numero = numero;
  const facturxInvoice = buildFacturxInvoice(pdfData, numero);
  let pdfBytes: Buffer;
  let pdfSha256: string;
  try {
    const pdf = await archiveFacturxPdf(pdfData, facturxInvoice);
    pdfBytes = pdf.bytes;
    pdfSha256 = pdf.sha256;
  } catch (err) {
    console.error("[factures/emettre] PDF generation error (invoice not emitted, still BROUILLON):", err);
    res.status(500).json({
      error: "Impossible de générer le PDF. La facture n'a pas été émise — réessayez.",
    });
    return;
  }

  // 7. ATOMIC COMMIT: facture → EMISE + archived_pdfs INSERT in the same transaction.
  //    If either write fails, both are rolled back — no partial state is possible.
  //    A concurrent request that already emitted this facture → UPDATE matches 0 rows → 409.
  let emitted: typeof facturesTable.$inferSelect;
  try {
    const result = await withTenant(tenantId, async tx => {
      const [committed] = await tx.update(facturesTable)
        .set({
          statut: "EMISE",
          number: numero,
          issuedDate,
          dueDate,
          pdfPath: null,           // no longer stored on disk
          pdfSha256,
          residualCents: preCheck.amountCents,
        })
        .where(and(eq(facturesTable.id, id!), eq(facturesTable.statut, "BROUILLON")))
        .returning();

      if (!committed) {
        const [cur] = await tx.select({ statut: facturesTable.statut })
          .from(facturesTable).where(eq(facturesTable.id, id!));
        return { kind: cur ? "conflict" as const : "not_found" as const, statut: cur?.statut };
      }

      // Archive PDF bytes in the same transaction — atomically with the status change.
      await tx.insert(archivedPdfsTable).values({
        id: crypto.randomUUID(),
        tenantId,
        documentType: "FACTURE",
        documentId: id!,
        bytes: pdfBytes,
        sha256: pdfSha256,
        byteSize: pdfBytes.length,
      });

      await tx.insert(activityTable).values({
        tenantId,
        type: "facture_emise",
        label: `Facture émise : ${numero}`,
        meta: preCheck.customerName,
      });

      return { kind: "ok" as const, facture: committed! };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Facture introuvable" });
      return;
    }
    if (result.kind === "conflict") {
      res.status(409).json({ error: `Facture déjà ${result.statut} — impossible de réémettre.` });
      return;
    }
    emitted = result.facture as typeof facturesTable.$inferSelect;
  } catch (err) {
    // TX failed — facture stays BROUILLON, no PDF on disk, nothing to clean up.
    console.error("[factures/emettre] DB commit error:", err);
    res.status(500).json({ error: "Erreur lors de la sauvegarde. Réessayez." });
    return;
  }

  // 8. Send email if requested (non-blocking — emission already succeeded)
  if (opts.sendEmail && opts.emailTo) {
    try {
      await sendDocument({
        canal: "EMAIL",
        tenantId,
        documentType: "FACTURE",
        documentId: id!,
        to: opts.emailTo,
        subject: `Facture ${numero} — ${seller.nom}`,
        body: `Bonjour,\n\nVeuillez trouver ci-joint la facture ${numero} de ${seller.nom}.\n\nCordialement,\n${seller.nom}`,
        attachments: [{ filename: `${numero}.pdf`, content: pdfBytes }],
        fromName: seller.nom,
      });
    } catch (err) {
      console.warn("[factures/emettre] email send failed (non-fatal):", err);
    }
  }

  // 9. Objectifs — l'émission vient de changer le chiffre d'affaires.
  //
  // ÉVALUÉ ICI, PAS À LA LECTURE DU COCKPIT. Un franchissement horodaté au
  // moment où quelqu'un REGARDE ne dit rien : un artisan qui n'ouvre pas son
  // cockpit pendant trois semaines verrait son objectif « franchi
  // aujourd'hui ».
  //
  // `evaluerFranchissements` ne lève jamais : la facture est émise, immuable
  // et déjà écrite — l'annonce d'un objectif ne vaut pas qu'on la remette en
  // cause.
  const franchis = await evaluerFranchissements(tenantId);

  res.json({
    ...emitted,
    /** Objectifs franchis PAR CETTE ÉMISSION. Vide le reste du temps. */
    objectifsFranchis: franchis.map((f) => ({
      objectif: f.objectif,
      montantCents: f.montantCents,
      message: messageFranchissement(f),
    })),
  });
});

/** GET /api/factures/:id/pdf — serves the archived PDF (always same bytes). */
router.get("/factures/:id/pdf", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;

  const [facture] = await withTenant(tenantId, tx =>
    tx.select().from(facturesTable).where(eq(facturesTable.id, id!)),
  );
  if (!facture) { res.status(404).json({ error: "Facture introuvable" }); return; }

  // Primary source: archived_pdfs table (new path — zero disk dependency).
  const [archived] = await withTenant(tenantId, tx =>
    tx.select().from(archivedPdfsTable).where(
      and(
        eq(archivedPdfsTable.documentType, "FACTURE"),
        eq(archivedPdfsTable.documentId, id!),
      ),
    ),
  );

  if (archived) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${facture.number}.pdf"`);
    res.setHeader("X-Pdf-Sha256", archived.sha256);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(archived.bytes);
    return;
  }

  // Fallback: disk file for factures emitted before the DB-archival migration.
  if (!facture.pdfPath) {
    res.status(404).json({ error: "PDF non encore généré. Émettez la facture d'abord." });
    return;
  }

  const pdfBytes = readArchivedPdf(facture.pdfPath);
  if (!pdfBytes) {
    res.status(404).json({ error: "Fichier PDF introuvable sur le serveur." });
    return;
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${facture.number}.pdf"`);
  res.setHeader("X-Pdf-Sha256", facture.pdfSha256 ?? "");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.send(pdfBytes);
});

/** POST /api/factures/:id/payer — marque la facture comme payée (EMISE seulement). */
router.post("/factures/:id/payer", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;

  const result = await withTenant(tenantId, async tx => {
    const [f] = await tx.select().from(facturesTable).where(eq(facturesTable.id, id!));
    if (!f) return { kind: "not_found" as const };
    // Only an EMISE facture can be marked as paid; all other statuts are rejected.
    if (f.statut !== "EMISE") return { kind: "wrong_status" as const, statut: f.statut };

    // ── Passe par le JOURNAL, comme tout le reste ─────────────────────────
    // Deux façons d'écrire le même fait, ce sont deux façons de le rendre
    // faux. Cette route n'écrit donc plus l'état de la facture : elle
    // enregistre un paiement du RESTE DÛ, et le recalcul commun s'occupe du
    // statut. Sans quoi une facture pourrait être « payée » sans qu'aucun
    // règlement n'existe au journal.
    const dejaEncaisse = await encaisseSurFacture(tx, id!);
    const resteDu = Math.round(f.amountCents - dejaEncaisse);
    if (resteDu > 0) {
      await tx.insert(paiementsTable).values({
        tenantId,
        factureId: id!,
        clientId: f.clientId ?? null,
        affaireId: f.affaireId ?? null,
        date: toDateString(new Date()),
        montantCents: resteDu,
        sens: "ENCAISSEMENT",
        moyen: "AUTRE",
        nature: "SOLDE",
      });
    }
    await recalculerFacture(tx, id!);
    const [updated] = await tx.select().from(facturesTable).where(eq(facturesTable.id, id!));
    await tx.insert(activityTable).values({
      tenantId,
      type: "facture_paid",
      label: `Facture réglée : ${f.number}`,
      meta: f.customerName,
    });
    return { kind: "ok" as const, facture: updated! };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Facture introuvable" }); return; }
  if (result.kind === "wrong_status") {
    res.status(409).json({
      error: `Seule une facture EMISE peut être marquée payée (statut actuel : ${result.statut}).`,
    });
    return;
  }
  res.json(result.facture);
});

export default router;
