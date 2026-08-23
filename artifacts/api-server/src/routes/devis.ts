import { Router, type IRouter } from "express";
import { withTenant, devisTable, affairesTable, cleJetonDevis } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { createHash } from "node:crypto";
import { enregistrerSecret, lireSecret, revoquerSecret } from "../lib/tenant-secrets.js";
import { pdfDevisParId, nomFichierDevis, genererPdfDevis, chargerEmetteur } from "../lib/pdf-devis.js";
import type { DevisLine, DevisAddress } from "@workspace/db";
import { sendDocument } from "../lib/canal-emission.js";
import { toDateString } from "@nodaq/shared";
import { indexerAuClasseur, nomAuClasseur } from "../lib/indexation-classeur.js";
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
  if (v instanceof Date) return toDateString(v);
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
    await indexerAuClasseur(tx, {
      tenantId, sourceType: "DEVIS", sourceId: d!.id,
      nom: nomAuClasseur("DEVIS", d!.reference, d!.id), affaireId: d!.affaireId,
    });
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
  // Le jeton part avec le devis : un secret orphelin ne sert plus qu'à être
  // oublié, et le magasin n'a pas de nettoyage automatique.
  await revoquerSecret(tenantId, cleJetonDevis(parsed.data.id));
  res.status(204).send();
});

/**
 * Engendre un jeton, range son condensat en base et le jeton lui-même CHIFFRÉ
 * dans le magasin. Rend le jeton en clair à l'appelant, une seule fois.
 *
 * Le condensat sert à VÉRIFIER (policy publique, égalité sur colonne indexée).
 * Le chiffré sert à RECONSTRUIRE le lien lors d'un renvoi. Les deux répondent à
 * deux questions différentes, d'où les deux rangements.
 */
async function poserNouveauJeton(tenantId: string, devisId: string): Promise<string> {
  const acceptToken = crypto.randomUUID();
  await withTenant(tenantId, (tx) =>
    tx
      .update(devisTable)
      .set({ acceptTokenSha256: createHash("sha256").update(acceptToken).digest("hex") })
      .where(eq(devisTable.id, devisId)),
  );
  await enregistrerSecret(tenantId, cleJetonDevis(devisId), acceptToken);
  return acceptToken;
}

/** L'URL publique d'acceptation. La seule apparition du jeton en clair. */
function urlAcceptation(token: string): string {
  return `${process.env.APP_URL ?? "https://nodaq.fr"}/devis/accepter/${token}`;
}

/**
 * POST /api/devis/:id/envoyer — envoie le devis par e-mail.
 *
 * RENVOYER RÉUTILISE LE JETON EXISTANT. Un artisan dont le client dit ne pas
 * avoir reçu le devis renvoie le même lien, et l'ancien e-mail continue de
 * fonctionner. Régénérer ici transformerait une action serviable en action
 * destructrice, dont les dégâts tomberaient sur le CLIENT — qui retrouve
 * l'ancien message, clique, et lit « lien invalide ou expiré » sur la seule
 * page du produit qu'il voit jamais.
 *
 * Le remplacement d'un lien est une décision distincte : `POST
 * /devis/:id/nouveau-lien`, explicite et confirmée.
 */
router.post("/devis/:id/envoyer", async (req, res): Promise<void> => {
  const parsed = SendDevisBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const { id } = req.params;

  const existant = await withTenant(tenantId, async (tx) => {
    const [devis] = await tx.select().from(devisTable).where(eq(devisTable.id, id!));
    return devis ?? null;
  });
  if (!existant) { res.status(404).json({ error: "Devis introuvable" }); return; }

  // Réutilisation si — et seulement si — le jeton est retrouvable en entier :
  // condensat en base ET valeur dans le magasin. Un condensat orphelin (devis
  // envoyé avant ce lot) ne permet pas de reconstruire le lien ; on en pose un
  // neuf plutôt que d'envoyer un e-mail sans lien.
  const dejaPose = existant.acceptTokenSha256
    ? await lireSecret(tenantId, cleJetonDevis(existant.id))
    : null;
  const acceptToken = dejaPose ?? (await poserNouveauJeton(tenantId, existant.id));

  const [updated] = await withTenant(tenantId, (tx) =>
    tx
      .update(devisTable)
      .set({ status: "ENVOYE", dateEnvoi: new Date() })
      .where(eq(devisTable.id, existant.id))
      .returning(),
  );
  if (!updated) { res.status(404).json({ error: "Devis introuvable" }); return; }

  const acceptUrl = urlAcceptation(acceptToken);

  // LE DEVIS PART EN PIÈCE JOINTE.
  //
  // `canal-emission.ts` accepte des pièces jointes depuis toujours ; personne
  // ne lui en passait. Le client recevait un lien, arrivait sur une page, et
  // n'avait RIEN à garder, à imprimer, à montrer chez lui ou à faire chiffrer
  // ailleurs. Un artisan qui envoie un devis sans PDF passe pour un amateur,
  // quelle que soit la qualité de la page.
  const emetteurDevis = await chargerEmetteur(tenantId);
  const pdfDevis = await genererPdfDevis(updated, emetteurDevis);

  const envoi = await sendDocument({
    canal: "EMAIL",
    tenantId,
    documentType: "DEVIS",
    documentId: updated.id,
    to: parsed.data.emailTo,
    subject: `Devis ${updated.reference} — bon pour accord`,
    body: [
      `Bonjour,\n\nVeuillez trouver votre devis ${updated.reference} ci-dessous.`,
      parsed.data.message ?? "",
      `\nPour l'accepter en ligne : ${acceptUrl}`,
      `\nMontant TTC : ${(updated.totalTTCCents / 100).toFixed(2)} €`,
      `\nValable jusqu'au : ${updated.validUntil ?? "—"}`,
    ].filter(Boolean).join("\n"),
    attachments: [
      {
        filename: nomFichierDevis(updated.reference),
        content: pdfDevis,
        contentType: "application/pdf",
      },
    ],
  });

  res.json({
    ...updated,
    acceptUrl,
    /** Vrai quand le lien envoyé est celui d'un envoi précédent. */
    lienReutilise: dejaPose !== null,
    // L'écran doit pouvoir dire à l'artisan que son devis est parti en repli.
    modeEnvoi: envoi.mode,
    avertissementDelivrabilite: envoi.avertissementDelivrabilite ?? false,
  });
});

/**
 * POST /api/devis/:id/nouveau-lien — REMPLACE le lien d'acceptation.
 *
 * Action explicite et nommée, séparée du renvoi. Elle existe pour le cas réel
 * où l'artisan doit transmettre le lien autrement — SMS, messagerie — et a donc
 * besoin de le VOIR. Comme le jeton précédent n'est plus affichable, la seule
 * façon d'en obtenir un lisible est d'en poser un neuf.
 *
 * Elle invalide le lien précédent, et c'est le fond de l'affaire : c'est
 * pourquoi elle est explicite, confirmée côté interface, et jamais déclenchée
 * par un renvoi.
 */
router.post("/devis/:id/nouveau-lien", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  if (typeof id !== "string" || id.length === 0) {
    res.status(404).json({ error: "Devis introuvable" });
    return;
  }

  const [devis] = await withTenant(tenantId, (tx) =>
    tx.select().from(devisTable).where(eq(devisTable.id, id)),
  );
  if (!devis) { res.status(404).json({ error: "Devis introuvable" }); return; }

  // Un devis déjà accepté ne se rouvre pas : le lien n'ouvrirait qu'une page
  // « déjà accepté », et en engendrer un neuf laisserait croire le contraire.
  if (devis.acceptedAt) {
    res.status(409).json({ error: "Ce devis a déjà été accepté." });
    return;
  }

  const acceptToken = await poserNouveauJeton(tenantId, devis.id);
  res.json({
    acceptUrl: urlAcceptation(acceptToken),
    /** L'ancien lien ne fonctionne plus. L'écran l'a annoncé avant d'appeler. */
    ancienLienInvalide: true,
    reference: devis.reference,
  });
});

/**
 * GET /api/devis/:id/pdf — le PDF du devis, pour le tenant propriétaire.
 *
 * Engendré à la volée : un devis reste modifiable tant qu'il n'est pas
 * accepté, donc le figer serait servir une version périmée.
 */
router.get("/devis/:id/pdf", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  if (typeof id !== "string" || id.length === 0) {
    res.status(404).json({ error: "Devis introuvable" });
    return;
  }

  const [devis] = await withTenant(tenantId, (tx) =>
    tx.select().from(devisTable).where(eq(devisTable.id, id)),
  );
  if (!devis) { res.status(404).json({ error: "Devis introuvable" }); return; }

  const pdf = await pdfDevisParId(tenantId, id);
  if (!pdf) { res.status(404).json({ error: "Devis introuvable" }); return; }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${nomFichierDevis(devis.reference)}"`);
  res.send(pdf);
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
      startDate: toDateString(new Date()),
    }).returning();
    await tx.update(devisTable).set({ status: "ACCEPTE", affaireId: affaire!.id }).where(eq(devisTable.id, d.id));
    return { affaire };
  });

  if ("error" in result) { res.status(result.status ?? 422).json({ error: result.error }); return; }
  res.json(result.affaire);
});

export default router;
