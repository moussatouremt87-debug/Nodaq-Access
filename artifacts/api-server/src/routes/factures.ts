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
import {
  withTenant, facturesTable, avoirsTable, activityTable, archivedPdfsTable,
  paiementsTable, CLE_PA_API_KEY, devisTable,
} from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { facturerDevis, messageRefusFacturation } from "../lib/facturer-devis.js";
import { auditInvoice } from "@nodaq/facturx";
import { toDateString, type Vertical } from "@nodaq/shared";
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
import { loadCompanySettings, sellerInfoFromSettings } from "../lib/seller-info.js";
import { sendDocument } from "../lib/canal-emission.js";
import { auditEmissionElectronique } from "../lib/emission-electronique.js";
import { logger } from "../lib/logger.js";
import { champsErreur } from "../lib/erreur-pg.js";
import { secretExiste } from "../lib/tenant-secrets.js";
import { estFactureEnRetard, residuelFactureCents } from "../lib/facturesEnRetard.js";
import { VERTICAL_SETTING_KEY, DEFAULT_VERTICAL } from "../lib/vertical-tenant.js";
import { indexerAuClasseur, nomAuClasseur } from "../lib/indexation-classeur.js";

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


/**
 * Charge les réglages entreprise d'un tenant, et son vertical (US-A2.5 :
 * `auditMentionsFR` en a besoin pour ne gater les règles travaux
 * qu'aux secteurs réellement concernés). Une seule lecture `settings`
 * (`loadCompanySettings`) — `byKey` porte déjà toutes les lignes, la clé
 * vertical n'ajoute aucune requête. Le mapping `SellerInfo` lui-même vit
 * dans `lib/seller-info.ts`, partagé avec `avoirs.ts`/`pdf-devis.ts`.
 */
async function loadSellerInfo(tenantId: string): Promise<{ seller: SellerInfo; vertical: Vertical }> {
  const byKey = await loadCompanySettings(tenantId);
  const seller = sellerInfoFromSettings(byKey);
  const vertical = (byKey[VERTICAL_SETTING_KEY] as Vertical | undefined) ?? DEFAULT_VERTICAL;
  return { seller, vertical };
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

/**
 * Un numéro attribué qui ne deviendra jamais une facture.
 *
 * ── POURQUOI CE JOURNAL EXISTE ──────────────────────────────────────────────
 * Le numéro est attribué et validé en base AVANT la génération du PDF, pour
 * que le PDF porte le vrai numéro légal. C'est un arbitrage assumé : si le PDF
 * échoue ensuite, le numéro est perdu et la séquence a un trou. Un trou vaut
 * mieux qu'une facture légalement émise sans son PDF archivé.
 *
 * Mais un trou dans une numérotation doit pouvoir S'EXPLIQUER. Une séquence
 * qui saute de FACT-2026-0007 à FACT-2026-0009 est, pour un contrôleur, une
 * facture manquante jusqu'à preuve du contraire. Ces lignes sont cette preuve :
 * la date, le numéro, et la raison pour laquelle il n'a jamais servi.
 *
 * `warn` et non `info` : ce n'est pas la marche normale, et un trou fréquent
 * signalerait un défaut en amont plutôt qu'un incident isolé.
 */
function journaliserNumeroBrule(tenantId: string, numero: string, raison: string): void {
  logger.warn(
    { tenantId, numero, raison, etape: "numero_brule" },
    "[factures/emettre] numéro brûlé — trou assumé dans la séquence",
  );
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
  const aujourdhui = toDateString(new Date());
  const totalOverdueCents = filtered
    .filter(f => estFactureEnRetard(f, aujourdhui))
    .reduce((acc, f) => acc + residuelFactureCents(f), 0);

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

  const [created] = await withTenant(tenantId, async (tx) => {
    const [f] = await tx.insert(facturesTable).values({
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
    }).returning();
    // Ticket 4.31 b — DANS la transaction : une entrée de Classeur pour une
    // facture dont la création échouerait ensuite serait un fantôme.
    await indexerAuClasseur(tx, {
      tenantId, sourceType: "FACTURE", sourceId: f!.id,
      nom: nomAuClasseur("FACTURE", f!.number, f!.id), affaireId: f!.affaireId,
    });
    return [f];
  });

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
  const { seller, vertical } = await loadSellerInfo(tenantId);

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
  const mentionIssues = auditMentionsFR(pdfData, vertical);
  const blockers = mentionIssues.filter(i => i.bloquant);
  if (blockers.length > 0) {
    res.status(422).json({
      error: "Émission bloquée — mentions obligatoires manquantes.",
      issues: blockers.map(i => ({ code: i.code, message: i.message })),
    });
    return;
  }

  // 3bis. Émission électronique obligatoire (US-A2.6) — no-op avant le
  // 01/09/2027 (voir emission-electronique.ts), donc sans effet aujourd'hui.
  const paConfiguree = await secretExiste(tenantId, CLE_PA_API_KEY);
  const emissionIssues = auditEmissionElectronique(new Date(), paConfiguree);
  const emissionBlockers = emissionIssues.filter(i => i.bloquant);
  if (emissionBlockers.length > 0) {
    res.status(422).json({
      error: "Émission bloquée — facturation électronique obligatoire non configurée.",
      issues: emissionBlockers.map(i => ({ code: i.code, message: i.message })),
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
    // Le code SQLSTATE est ici la seule information qui compte : il distingue
    // un doublon de numéro (23505, donc la contrainte d'unicité a parlé) d'un
    // verrou ou d'une sérialisation (40001, 40P01, 55P03). `console.error`
    // aplatissait l'objet et perdait exactement cela.
    logger.error(
      { ...champsErreur(err), tenantId, annee: year, etape: "attribution_numero" },
      "[factures/emettre] attribution du numéro impossible",
    );
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
    journaliserNumeroBrule(tenantId, numero, "echec_generation_pdf");
    logger.error(
      { ...champsErreur(err), tenantId, etape: "generation_pdf" },
      "[factures/emettre] génération du PDF impossible — facture toujours BROUILLON",
    );
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
      journaliserNumeroBrule(tenantId, numero, "facture_introuvable");
      res.status(404).json({ error: "Facture introuvable" });
      return;
    }
    if (result.kind === "conflict") {
      // Deux émissions simultanées de la MÊME facture : l'une gagne l'UPDATE
      // gardé par `statut = BROUILLON`, l'autre repart avec son numéro sur les
      // bras. C'est le trou le plus banal, et le plus facile à expliquer.
      journaliserNumeroBrule(tenantId, numero, "facture_deja_emise");
      res.status(409).json({ error: `Facture déjà ${result.statut} — impossible de réémettre.` });
      return;
    }
    emitted = result.facture as typeof facturesTable.$inferSelect;
  } catch (err) {
    // TX failed — facture stays BROUILLON, no PDF on disk, nothing to clean up.
    //
    // C'est ICI que la contrainte `factures_tenant_number_unique` se ferait
    // entendre si deux émissions obtenaient le même numéro : SQLSTATE 23505,
    // avec le nom de la contrainte. Avant elle, le doublon passait en silence
    // et ne se serait vu qu'au contrôle fiscal.
    journaliserNumeroBrule(tenantId, numero, "echec_ecriture_base");
    logger.error(
      { ...champsErreur(err), tenantId, etape: "commit_emission" },
      "[factures/emettre] écriture de l'émission impossible — facture toujours BROUILLON",
    );
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
    /**
     * US-A7.1 — les mentions manquantes NON bloquantes.
     *
     * Elles étaient calculées puis jetées : `blockers` seul était rendu, et
     * une règle non bloquante (la décennale, par exemple) n'atteignait donc
     * jamais l'utilisateur. Une vérification dont le résultat est écarté ne
     * vérifie rien. Champ ADDITIF, sur le modèle d'`objectifsFranchis`
     * juste en dessous — aucun appelant existant n'en dépend.
     */
    avertissementsMentions: mentionIssues
      .filter((i) => !i.bloquant)
      .map((i) => ({ code: i.code, message: i.message })),
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

/**
 * POST /api/factures/:id/annuler-paiement — défait un « marquer comme payée ».
 *
 * ── Pourquoi cette route existe ───────────────────────────────────────────
 * « J'ai cliqué sur "marquer comme payée" par accident mais je n'ai pas de
 * moyen de revenir en arrière. » Une action qui change un état FINANCIER et
 * qu'on ne peut pas défaire transforme un geste de trop en écriture fausse
 * définitive.
 *
 * ── Ce qu'elle défait, et rien d'autre ────────────────────────────────────
 * Le DERNIER encaissement de la facture, celui qu'on vient de créer. Pas
 * « tous les règlements » : un client qui a réellement versé un acompte
 * garderait sa ligne, et l'effacer serait une seconde erreur pour en corriger
 * une première.
 *
 * Elle écrit une CONTRE-PASSATION, elle ne supprime rien.
 *
 * La première version de cette route supprimait la ligne, au motif qu'un
 * règlement saisi par erreur n'a jamais eu lieu. Le moteur a refusé :
 * `app_user` n'a que SELECT et INSERT sur `paiements`, qui figure dans
 * `APPEND_ONLY_TABLES` de `create-app-role.cjs`, au même titre que les PDF
 * archivés. Le journal des règlements est immuable par construction, et le
 * script ré-applique cette révocation à chaque provisionnement pour qu'elle
 * survive.
 *
 * C'est le moteur qui avait raison. Un journal qu'on peut réécrire ne prouve
 * rien, et « ça n'a jamais eu lieu » est précisément ce qu'un journal comptable
 * n'a pas le droit de dire à la place de l'histoire réelle. La correction
 * s'écrit donc en sens inverse — ANNULATION du même montant, un sens créé
 * pour ça par la migration 050 — et
 * `encaisseSurFacture` la compte déjà en négatif.
 *
 * Le statut n'est PAS écrit à la main : `recalculerFacture` le redéduit du
 * journal, comme partout ailleurs. Deux façons d'écrire le même fait sont deux
 * façons de le rendre faux.
 */
router.post("/factures/:id/annuler-paiement", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;

  const result = await withTenant(tenantId, async tx => {
    const [f] = await tx.select().from(facturesTable).where(eq(facturesTable.id, id!));
    if (!f) return { kind: "not_found" as const };
    // Une facture annulée par avoir ne se « dépaye » pas : l'avoir est le
    // document qui fait foi, et le toucher ici casserait la chaîne comptable.
    if (f.statut === "ANNULEE_PAR_AVOIR") {
      return { kind: "wrong_status" as const, statut: f.statut };
    }

    // Le dernier encaissement PAS ENCORE contre-passé. Le lien se fait par
    // `reference` : sans lui, deux clics d'annulation successifs annuleraient
    // deux fois le même règlement et créeraient un solde négatif.
    const dejaAnnules = await tx
      .select({ reference: paiementsTable.reference })
      .from(paiementsTable)
      .where(and(eq(paiementsTable.factureId, id!), eq(paiementsTable.sens, "ANNULATION")));
    const annulees = new Set(
      dejaAnnules.map((d) => d.reference).filter((r): r is string => !!r),
    );

    const encaissements = await tx
      .select()
      .from(paiementsTable)
      .where(and(eq(paiementsTable.factureId, id!), eq(paiementsTable.sens, "ENCAISSEMENT")))
      .orderBy(desc(paiementsTable.createdAt));
    const dernier = encaissements.find((e) => !annulees.has(`annulation:${e.id}`));
    if (!dernier) return { kind: "rien_a_annuler" as const };

    const statutAvant = f.statut;
    await tx.insert(paiementsTable).values({
      tenantId,
      factureId: id!,
      clientId: f.clientId ?? null,
      affaireId: f.affaireId ?? null,
      date: toDateString(new Date()),
      montantCents: dernier.montantCents,
      sens: "ANNULATION",
      moyen: dernier.moyen,
      nature: dernier.nature,
      // Le lien vers l'écriture corrigée : c'est ce qui rend l'annulation
      // idempotente et le journal relisable.
      reference: `annulation:${dernier.id}`,
    });
    await recalculerFacture(tx, id!);
    const [apres] = await tx.select().from(facturesTable).where(eq(facturesTable.id, id!));

    // Trace : qui, quand, quoi, avant → après. Dans `activity` et non dans
    // `journal_decisions`, dont la colonne `decision` porte une contrainte
    // CHECK à trois valeurs (APPROUVEE | REJETEE | EXPIREE) : c'est le journal
    // des VALIDATIONS d'actions agentiques, pas un audit général. L'y forcer
    // demanderait de relâcher sa contrainte, donc d'affaiblir une garde pour
    // un usage qu'elle n'a jamais visé.
    await tx.insert(activityTable).values({
      tenantId,
      type: "facture_paiement_annule",
      label: `Règlement annulé sur la facture ${f.number || "(brouillon)"}`,
      meta: `${(dernier.montantCents / 100).toFixed(2)} € — ${statutAvant} → ${apres!.statut} — ${req.session?.email ?? "inconnu"}`,
    });

    return { kind: "ok" as const, facture: apres!, montantAnnuleCents: dernier.montantCents };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Facture introuvable" }); return; }
  if (result.kind === "wrong_status") {
    res.status(409).json({
      error: "Une facture annulée par avoir ne peut pas être dépayée : c'est l'avoir qui fait foi.",
    });
    return;
  }
  if (result.kind === "rien_a_annuler") {
    res.status(409).json({ error: "Aucun règlement à annuler sur cette facture." });
    return;
  }
  res.json(result);
});

/**
 * POST /devis/:id/facturer — la facture issue d'un devis accepté.
 *
 * ── Ce que cette route REFUSE de faire ────────────────────────────────────
 * Émettre. Elle crée un BROUILLON : le numéro, la date d'émission et l'archive
 * PDF appartiennent à `/factures/:id/emettre`, qui les pose dans la même
 * transaction et de façon irréversible. Facturer d'un geste et émettre d'un
 * autre, ce n'est pas une lourdeur — c'est la différence entre préparer un
 * document et l'opposer à un client.
 *
 * ── L'invariant : la facture vaut le devis, au centime ────────────────────
 * Un devis applique sa remise au SOUS-TOTAL ; une facture calcule ligne par
 * ligne. Reporter l'un dans l'autre sans vérifier laisserait passer un écart
 * d'arrondi — c'est-à-dire facturer un autre montant que celui qui a été
 * accepté et signé. La conversion compare donc les deux totaux et REFUSE en
 * cas d'écart, plutôt que de produire un document faux avec assurance.
 */
router.post("/devis/:id/facturer", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;

  const resultat = await withTenant(tenantId, (tx) => facturerDevis(tx, tenantId, id!));

  switch (resultat.kind) {
    case "introuvable":
      res.status(404).json({ error: messageRefusFacturation(resultat) });
      return;
    case "non_accepte":
    case "sans_ligne":
    case "ecart":
      res.status(422).json({ error: messageRefusFacturation(resultat) });
      return;
    case "deja":
      res.status(200).json(resultat.facture);
      return;
    case "ok":
      res.status(201).json(resultat.facture);
      return;
  }
});

export default router;
