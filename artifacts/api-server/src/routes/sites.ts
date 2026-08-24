/*
 * Les sites d'un contrat multi-sites — US-B7.1.
 *
 * ── Ce que la story demande, et l'équilibre qu'elle impose ────────────────
 * « Chaque site associé peut être planifié et suivi INDÉPENDAMMENT tout en
 * remontant à une facturation CONSOLIDÉE pour le client. »
 *
 * Les deux moitiés tirent en sens contraire, et c'est tout le sujet : le
 * terrain travaille site par site — huit agences, huit tournées, huit
 * responsables à faire signer — pendant que la comptabilité veut UNE facture
 * par client. Séparer ces deux plans est ce que huit contrats distincts ne
 * savaient pas faire.
 *
 * Ce routeur tient la première moitié. La seconde vit dans la facturation
 * récurrente, qui construit une ligne par site sur une facture unique.
 */
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, sitesTable, clientsTable, contratsTable } from "@workspace/db";
import { estViolationUnicite } from "../lib/erreur-postgres.js";

const router: IRouter = Router();

const CreerSite = z.object({
  clientId: z.string().min(1),
  contratId: z.string().min(1).optional(),
  libelle: z.string().min(1).max(200),
  adresse: z.string().max(300).optional(),
  codePostal: z.string().max(20).optional(),
  ville: z.string().max(120).optional(),
  /** En centimes. Absent = le site n'est pas facturé à part. */
  montantCents: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

const ModifierSite = CreerSite.partial().extend({
  actif: z.boolean().optional(),
});

router.get("/sites", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const contratId = typeof req.query["contratId"] === "string" ? req.query["contratId"] : null;
  const clientId = typeof req.query["clientId"] === "string" ? req.query["clientId"] : null;

  const lignes = await withTenant(tenantId, (tx) => {
    const conditions = [
      contratId ? eq(sitesTable.contratId, contratId) : undefined,
      clientId ? eq(sitesTable.clientId, clientId) : undefined,
    ].filter((c) => c !== undefined);
    return tx.select().from(sitesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
  });
  res.json(lignes);
});

router.post("/sites", async (req, res): Promise<void> => {
  const parsed = CreerSite.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const tenantId = req.tenantId!;

  const resultat = await withTenant(tenantId, async (tx) => {
    // Le client est vérifié, pas supposé : un site rattaché à un client
    // inexistant ne remonterait dans aucune facture et resterait invisible.
    const [client] = await tx.select({ id: clientsTable.id }).from(clientsTable)
      .where(eq(clientsTable.id, d.clientId));
    if (!client) return { kind: "client_introuvable" as const };

    if (d.contratId) {
      const [c] = await tx.select({ id: contratsTable.id, clientName: contratsTable.clientName })
        .from(contratsTable).where(eq(contratsTable.id, d.contratId));
      if (!c) return { kind: "contrat_introuvable" as const };
    }

    try {
      const [site] = await tx.insert(sitesTable).values({
        tenantId, clientId: d.clientId,
        contratId: d.contratId ?? null,
        libelle: d.libelle,
        adresse: d.adresse ?? null,
        codePostal: d.codePostal ?? null,
        ville: d.ville ?? null,
        montantCents: d.montantCents ?? null,
        notes: d.notes ?? null,
      }).returning();
      return { kind: "ok" as const, site };
    } catch (err) {
      // Deux « Agence Nord » sous le même contrat rendraient la facture
      // illisible : deux lignes du même nom, pour deux montants différents.
      //
      // Le code `23505` n'est PAS à la racine de l'erreur — Drizzle
      // l'enveloppe — d'où le dépliage partagé plutôt qu'un `err.message`
      // naïf, qui rendait 500 au lieu de 409.
      if (estViolationUnicite(err)) return { kind: "doublon" as const };
      throw err;
    }
  });

  switch (resultat.kind) {
    case "client_introuvable":
      res.status(422).json({ error: "Ce client n'existe pas. Créez-le avant d'y rattacher un site." });
      return;
    case "contrat_introuvable":
      res.status(422).json({ error: "Ce contrat n'existe pas." });
      return;
    case "doublon":
      res.status(409).json({
        error: "Un site porte déjà ce nom sous ce contrat. Deux lignes du même nom sur " +
          "une facture consolidée seraient impossibles à vérifier pour votre client.",
      });
      return;
    case "ok":
      res.status(201).json(resultat.site);
  }
});

router.patch("/sites/:id", async (req, res): Promise<void> => {
  const parsed = ModifierSite.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;

  const [site] = await withTenant(tenantId, (tx) =>
    tx.update(sitesTable).set({
      ...(parsed.data.libelle !== undefined ? { libelle: parsed.data.libelle } : {}),
      ...(parsed.data.adresse !== undefined ? { adresse: parsed.data.adresse } : {}),
      ...(parsed.data.codePostal !== undefined ? { codePostal: parsed.data.codePostal } : {}),
      ...(parsed.data.ville !== undefined ? { ville: parsed.data.ville } : {}),
      ...(parsed.data.montantCents !== undefined ? { montantCents: parsed.data.montantCents } : {}),
      ...(parsed.data.contratId !== undefined ? { contratId: parsed.data.contratId } : {}),
      ...(parsed.data.actif !== undefined ? { actif: parsed.data.actif } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    }).where(eq(sitesTable.id, req.params["id"]!)).returning(),
  );

  if (!site) { res.status(404).json({ error: "Site introuvable." }); return; }
  res.json(site);
});

/**
 * Un site ne se SUPPRIME pas, il se désactive.
 *
 * Un site fermé sort du planning et de la facturation, mais son historique
 * reste : le supprimer ferait disparaître des lignes de factures déjà émises
 * de la vue du client, sur un document qu'il a payé et archivé.
 */
router.delete("/sites/:id", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const [site] = await withTenant(tenantId, (tx) =>
    tx.update(sitesTable).set({ actif: false })
      .where(eq(sitesTable.id, req.params["id"]!)).returning(),
  );
  if (!site) { res.status(404).json({ error: "Site introuvable." }); return; }
  res.json({ ...site, message: "Site désactivé. Son historique de facturation est conservé." });
});

export default router;
