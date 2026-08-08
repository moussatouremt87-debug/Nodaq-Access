import { Router, type IRouter } from "express";
import { withTenant, devisTable, affairesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import type { DevisLine, DevisAddress } from "@workspace/db";
import { sendDocument } from "../lib/canal-emission.js";
import {
  ListDevisQueryParams,
  GetDevisParams,
  UpdateDevisParams,
  DeleteDevisParams,
  ConvertDevisToAffaireParams,
} from "@workspace/api-zod";

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
  description: z.string().default(""),
  quantity: z.number().default(1),
  unitPriceCents: z.number().int().nonnegative().default(0),
  vatRate: z.number().refine(r => [20, 10, 5.5, 2.1, 0].includes(r), {
    message: "Taux TVA : 20, 10, 5.5, 2.1 ou 0",
  }).default(20),
  vatCategory: z.enum(["S", "Z", "E", "AE"]).default("S"),
  unit: z.string().optional(),
});

const CreateDevisBody = z.object({
  clientName: z.string().min(1),
  clientAddress: AddressSchema.optional(),
  chantierAddress: AddressSchema.optional(),
  status: z.string().optional(),
  lines: z.array(LineSchema).default([]),
  tvaRate: z.number().default(20),
  remise: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  validUntil: z.string().optional(),
  autoliquidation: z.boolean().default(false),
  retenueGarantiePct: z.number().min(0).max(5).default(0),
  affaireId: z.string().optional(),
});

const UpdateDevisBody = z.object({
  clientName: z.string().optional(),
  clientAddress: AddressSchema.optional(),
  chantierAddress: AddressSchema.optional(),
  status: z.string().optional(),
  lines: z.array(LineSchema).optional(),
  tvaRate: z.number().optional(),
  remise: z.number().min(0).max(100).optional(),
  notes: z.string().optional().nullable(),
  validUntil: z.string().optional().nullable(),
  autoliquidation: z.boolean().optional(),
  retenueGarantiePct: z.number().min(0).max(5).optional(),
  affaireId: z.string().optional(),
});

const SendDevisBody = z.object({
  emailTo: z.string().email("Adresse e-mail invalide"),
  message: z.string().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute totals from lines with per-line TVA.
 * Falls back to a single tvaRate when lines have no vatRate (legacy).
 */
function calcTotals(
  lines: Array<{ quantity: number; unitPriceCents: number; vatRate?: number }>,
  legacyTvaRate: number,
  remise: number,
  autoliquidation = false,
) {
  const subtotalCents = lines.reduce((acc, l) => acc + Math.round(l.quantity * l.unitPriceCents), 0);
  const afterRemiseCents = Math.round(subtotalCents * (1 - remise / 100));
  const totalHTCents = afterRemiseCents;

  let totalTVACents: number;
  if (autoliquidation) {
    totalTVACents = 0;
  } else if (lines.length > 0 && lines[0]?.vatRate !== undefined) {
    // Per-line TVA
    totalTVACents = lines.reduce((acc, l) => {
      const base = Math.round(l.quantity * l.unitPriceCents);
      const adjusted = Math.round(base * (1 - remise / 100));
      return acc + Math.round((adjusted * (l.vatRate ?? legacyTvaRate)) / 100);
    }, 0);
  } else {
    totalTVACents = Math.round(totalHTCents * legacyTvaRate / 100);
  }

  const totalTTCCents = totalHTCents + totalTVACents;
  return { totalHTCents, totalTTCCents };
}

function nextRef(count: number) {
  return `DEV-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
}

function toDateStr(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get("/devis", async (req, res): Promise<void> => {
  const parsed = ListDevisQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { statut, search } = parsed.data;
  const tenantId = req.tenantId!;

  let all = await withTenant(tenantId, async (tx) =>
    tx.select().from(devisTable).orderBy(desc(devisTable.createdAt))
  );
  if (statut) all = all.filter(d => d.status === statut);
  if (search) {
    const q = search.toLowerCase();
    all = all.filter(d => d.clientName.toLowerCase().includes(q) || d.reference.toLowerCase().includes(q));
  }

  const totalTTCCents = all.reduce((acc, d) => acc + d.totalTTCCents, 0);
  res.json({ devis: all, total: all.length, totalTTCCents });
});

router.post("/devis", async (req, res): Promise<void> => {
  const parsed = CreateDevisBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const {
    clientName, lines = [], tvaRate = 20, remise = 0, notes, validUntil,
    autoliquidation, retenueGarantiePct, affaireId,
    clientAddress, chantierAddress,
  } = parsed.data;

  const linesWithId: DevisLine[] = lines.map(l => ({
    ...l, id: l.id ?? crypto.randomUUID(),
  }));
  const { totalHTCents, totalTTCCents } = calcTotals(linesWithId, tvaRate, remise, autoliquidation);
  const tenantId = req.tenantId!;

  const created = await withTenant(tenantId, async (tx) => {
    const count = (await tx.select().from(devisTable)).length;
    const [d] = await tx.insert(devisTable).values({
      tenantId,
      reference: nextRef(count),
      clientName,
      status: parsed.data.status ?? "BROUILLON",
      lines: linesWithId,
      totalHTCents,
      totalTTCCents,
      tvaRate,
      remise,
      autoliquidation,
      retenueGarantiePct,
      clientAddress: clientAddress as DevisAddress | undefined,
      chantierAddress: chantierAddress as DevisAddress | undefined,
      affaireId: affaireId ?? undefined,
      ...(notes ? { notes } : {}),
      ...(validUntil ? { validUntil: toDateStr(validUntil as unknown as Date | string) } : {}),
    }).returning();
    return d;
  });

  res.status(201).json(created);
});

router.get("/devis/:id", async (req, res): Promise<void> => {
  const parsed = GetDevisParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const [d] = await withTenant(tenantId, async (tx) =>
    tx.select().from(devisTable).where(eq(devisTable.id, parsed.data.id))
  );
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  res.json(d);
});

router.patch("/devis/:id", async (req, res): Promise<void> => {
  const params = UpdateDevisParams.safeParse(req.params);
  const body = UpdateDevisBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const tenantId = req.tenantId!;

  const updated = await withTenant(tenantId, async (tx) => {
    const [existing] = await tx.select().from(devisTable).where(eq(devisTable.id, params.data.id));
    if (!existing) return null;

    const lines = (body.data.lines?.map(l => ({
      ...l, id: l.id ?? crypto.randomUUID(),
    })) ?? existing.lines) as DevisLine[];
    const tvaRate = body.data.tvaRate ?? existing.tvaRate;
    const remise  = body.data.remise  ?? existing.remise;
    const autoliquidation = body.data.autoliquidation ?? existing.autoliquidation;
    const { totalHTCents, totalTTCCents } = calcTotals(lines, tvaRate, remise, autoliquidation);

    const updatePayload: Record<string, unknown> = {
      lines, totalHTCents, totalTTCCents, tvaRate, remise, autoliquidation,
    };
    if (body.data.clientName !== undefined) updatePayload.clientName = body.data.clientName;
    if (body.data.status !== undefined) updatePayload.status = body.data.status;
    if (body.data.notes !== undefined) updatePayload.notes = body.data.notes || null;
    if (body.data.validUntil !== undefined) updatePayload.validUntil = toDateStr(body.data.validUntil as unknown as Date | string);
    if (body.data.retenueGarantiePct !== undefined) updatePayload.retenueGarantiePct = body.data.retenueGarantiePct;
    if (body.data.clientAddress !== undefined) updatePayload.clientAddress = body.data.clientAddress;
    if (body.data.chantierAddress !== undefined) updatePayload.chantierAddress = body.data.chantierAddress;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [u] = await tx.update(devisTable)
      .set(updatePayload as any)
      .where(eq(devisTable.id, params.data.id))
      .returning();
    return u;
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/devis/:id", async (req, res): Promise<void> => {
  const parsed = DeleteDevisParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  await withTenant(tenantId, async (tx) =>
    tx.delete(devisTable).where(eq(devisTable.id, parsed.data.id))
  );
  res.status(204).send();
});

/** POST /api/devis/:id/envoyer — envoie le devis par email + génère un accept_token. */
router.post("/devis/:id/envoyer", async (req, res): Promise<void> => {
  const parsed = SendDevisBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const { id } = req.params;

  const updated = await withTenant(tenantId, async tx => {
    const [devis] = await tx.select().from(devisTable).where(eq(devisTable.id, id!));
    if (!devis) return null;
    const acceptToken = devis.acceptToken ?? crypto.randomUUID();
    const [u] = await tx.update(devisTable).set({
      status: "ENVOYE",
      dateEnvoi: new Date(),
      acceptToken,
    }).where(eq(devisTable.id, id!)).returning();
    return u;
  });

  if (!updated) { res.status(404).json({ error: "Devis introuvable" }); return; }

  // Send email (dev: logged)
  const acceptUrl = `${process.env.APP_URL ?? "https://nodaq.fr"}/devis/accepter/${updated.acceptToken}`;
  await sendDocument({
    canal: "EMAIL",
    to: parsed.data.emailTo,
    subject: `Devis ${updated.reference} — bon pour accord`,
    body: [
      `Bonjour,\n\nVeuillez trouver votre devis ${updated.reference} ci-dessous.`,
      parsed.data.message ?? "",
      `\nPour l'accepter en ligne : ${acceptUrl}`,
      `\nMontant TTC : ${(updated.totalTTCCents / 100).toFixed(2)} €`,
      `\nValable jusqu'au : ${updated.validUntil ?? "—"}`,
    ].filter(Boolean).join("\n"),
  });

  res.json({ ...updated, acceptUrl });
});

router.post("/devis/:id/convert", async (req, res): Promise<void> => {
  const parsed = ConvertDevisToAffaireParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;

  const result = await withTenant(tenantId, async (tx) => {
    const [d] = await tx.select().from(devisTable).where(eq(devisTable.id, parsed.data.id));
    if (!d) return { error: "Not found", status: 404 };
    if (d.status !== "ACCEPTE") return { error: "Seuls les devis acceptés peuvent être convertis en affaire.", status: 422 };

    if (d.affaireId) {
      const [existing] = await tx.select().from(affairesTable).where(eq(affairesTable.id, d.affaireId));
      if (existing) return { affaire: existing };
    }

    const count = (await tx.select().from(affairesTable)).length;
    const ref = `AFF-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
    const [affaire] = await tx.insert(affairesTable).values({
      tenantId,
      reference: ref,
      label: `Affaire ${d.clientName}`,
      clientName: d.clientName,
      status: "ACCEPTEE",
      quotedAmountCents: d.totalTTCCents,
      ...(d.notes ? { notes: d.notes } : {}),
      startDate: new Date().toISOString().slice(0, 10),
    }).returning();
    await tx.update(devisTable).set({ status: "ACCEPTE", affaireId: affaire!.id }).where(eq(devisTable.id, d.id));
    return { affaire };
  });

  if ("error" in result) { res.status(result.status ?? 422).json({ error: result.error }); return; }
  res.json(result.affaire);
});

export default router;
