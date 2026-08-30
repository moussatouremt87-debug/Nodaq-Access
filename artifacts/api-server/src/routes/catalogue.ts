/**
 * Catalogue tarifaire du tenant.
 *
 * C'est la seule source de prix du devis dicté (CLAUDE.md §3). Ce fichier ne
 * fait que du CRUD déterministe et l'amorçage depuis l'existant : aucun appel
 * modèle ici.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { withTenant, catalogueLignesTable, catalogueAliasTable, devisTable } from "@workspace/db";
import type { DevisLine } from "@workspace/db";
import { apprendreAlias, oublierAlias, messageRefus } from "../lib/alias-catalogue.js";
import { normaliser } from "@nodaq/shared";
import { messageValidation } from "../lib/message-validation.js";

const router: IRouter = Router();

const CreateLigneBody = z.object({
  libelle: z.string().min(1).max(300),
  unite: z.string().max(20).nullable().optional(),
  prixUnitaireHtCents: z.coerce.number().int().min(0),
  tauxTva: z.coerce.number().min(0).max(100).optional().default(20),
  motsCles: z.array(z.string().min(1).max(60)).max(20).optional().default([]),
});

const UpdateLigneBody = CreateLigneBody.partial().extend({
  actif: z.boolean().optional(),
});

/** Violation d'unicité PostgreSQL, à travers l'enveloppe Drizzle. */
function estViolationUnicite(err: unknown): boolean {
  let courant: unknown = err;
  for (let i = 0; courant !== null && courant !== undefined && i < 5; i++) {
    if ((courant as { code?: string }).code === "23505") return true;
    courant = (courant as { cause?: unknown }).cause;
  }
  return false;
}

// ── Lecture ───────────────────────────────────────────────────────────────────

router.get("/catalogue", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const lignes = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(catalogueLignesTable)
      .where(eq(catalogueLignesTable.actif, true))
      .orderBy(asc(catalogueLignesTable.libelle)),
  );
  res.json({ lignes, total: lignes.length });
});

// ── Écriture ──────────────────────────────────────────────────────────────────

router.post("/catalogue", async (req, res): Promise<void> => {
  const parsed = CreateLigneBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const d = parsed.data;
  const tenantId = req.tenantId!;

  try {
    const [cree] = await withTenant(tenantId, (tx) =>
      tx.insert(catalogueLignesTable).values({
        tenantId,
        libelle: d.libelle,
        unite: d.unite ?? null,
        prixUnitaireHtCents: d.prixUnitaireHtCents,
        tauxTva: d.tauxTva,
        motsCles: d.motsCles,
        origine: "saisi",
      }).returning(),
    );
    res.status(201).json(cree);
  } catch (err) {
    if (estViolationUnicite(err)) {
      res.status(409).json({ error: "Ce libellé existe déjà dans le catalogue." });
      return;
    }
    throw err;
  }
});

router.patch("/catalogue/:id", async (req, res): Promise<void> => {
  const parsed = UpdateLigneBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const d = parsed.data;
  const id = req.params["id"] as string;
  const tenantId = req.tenantId!;

  const update: Record<string, unknown> = {};
  if (d.libelle !== undefined) update["libelle"] = d.libelle;
  if (d.unite !== undefined) update["unite"] = d.unite;
  if (d.prixUnitaireHtCents !== undefined) update["prixUnitaireHtCents"] = d.prixUnitaireHtCents;
  if (d.tauxTva !== undefined) update["tauxTva"] = d.tauxTva;
  if (d.motsCles !== undefined) update["motsCles"] = d.motsCles;
  if (d.actif !== undefined) update["actif"] = d.actif;
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "Aucun champ à modifier" });
    return;
  }

  const [modifie] = await withTenant(tenantId, (tx) =>
    tx.update(catalogueLignesTable).set(update).where(eq(catalogueLignesTable.id, id)).returning(),
  );
  if (!modifie) { res.status(404).json({ error: "Ligne introuvable" }); return; }
  res.json(modifie);
});

router.delete("/catalogue/:id", async (req, res): Promise<void> => {
  const id = req.params["id"] as string;
  const tenantId = req.tenantId!;
  const [supprime] = await withTenant(tenantId, (tx) =>
    tx.delete(catalogueLignesTable).where(eq(catalogueLignesTable.id, id)).returning(),
  );
  if (!supprime) { res.status(404).json({ error: "Ligne introuvable" }); return; }
  res.status(204).send();
});

// ── Amorçage depuis l'existant ────────────────────────────────────────────────

/**
 * POST /catalogue/amorcer — construit le catalogue depuis les devis déjà saisis.
 *
 * C'est la « reprise de l'existant » : un tenant qui a déjà émis des devis a
 * déjà un catalogue, il est simplement éparpillé dans ses lignes. On le
 * rassemble plutôt que de lui demander de tout ressaisir.
 *
 * Règles, volontairement prudentes :
 *  - on regroupe par libellé normalisé et on retient le prix le PLUS RÉCENT,
 *    pas une moyenne : une moyenne fabriquerait un prix qui n'a jamais été
 *    pratiqué ;
 *  - un libellé déjà présent au catalogue n'est jamais écrasé — l'existant
 *    saisi à la main fait autorité sur une déduction ;
 *  - opération idempotente : relancer n'ajoute rien de nouveau.
 */
router.post("/catalogue/amorcer", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  const resultat = await withTenant(tenantId, async (tx) => {
    const devis = await tx
      .select({ lines: devisTable.lines, createdAt: devisTable.createdAt })
      .from(devisTable)
      .orderBy(asc(devisTable.createdAt));

    const existantes = await tx.select().from(catalogueLignesTable);
    const dejaConnu = new Set(existantes.map((l) => normaliser(l.libelle)));

    // libellé normalisé → dernière occurrence rencontrée (les devis sont
    // parcourus du plus ancien au plus récent, donc la dernière écrase).
    const candidats = new Map<string, { libelle: string; unite: string | null; prixCents: number; tauxTva: number }>();

    for (const d of devis) {
      for (const ligne of (d.lines ?? []) as DevisLine[]) {
        const libelle = (ligne.description ?? "").trim();
        const cle = normaliser(libelle);
        if (cle.length === 0) continue;
        if (dejaConnu.has(cle)) continue;
        if (!Number.isFinite(ligne.unitPriceCents) || ligne.unitPriceCents <= 0) continue;

        candidats.set(cle, {
          libelle,
          unite: ligne.unit ?? null,
          prixCents: Math.round(ligne.unitPriceCents),
          tauxTva: ligne.vatRate ?? 20,
        });
      }
    }

    let crees = 0;
    for (const c of candidats.values()) {
      const inseres = await tx
        .insert(catalogueLignesTable)
        .values({
          tenantId,
          libelle: c.libelle,
          unite: c.unite,
          prixUnitaireHtCents: c.prixCents,
          tauxTva: c.tauxTva,
          motsCles: [],
          origine: "reprise",
        })
        .onConflictDoNothing()
        .returning();
      crees += inseres.length;
    }

    return { devisParcourus: devis.length, crees, dejaPresentes: existantes.length };
  });

  res.json(resultat);
});

// ── Alias appris ─────────────────────────────────────────────────────────────

/**
 * GET /catalogue/alias — ce que le produit a retenu.
 *
 * Affiché, jamais implicite : un artisan doit pouvoir relire ce qu'on a appris
 * de lui, et le défaire. Un apprentissage invisible est un apprentissage qu'on
 * ne peut pas corriger.
 */
router.get("/catalogue/alias", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const lignes = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: catalogueAliasTable.id,
        libelleDicte: catalogueAliasTable.libelleDicte,
        catalogueLigneId: catalogueAliasTable.catalogueLigneId,
        libelleCatalogue: catalogueLignesTable.libelle,
        createdAt: catalogueAliasTable.createdAt,
      })
      .from(catalogueAliasTable)
      .leftJoin(
        catalogueLignesTable,
        eq(catalogueAliasTable.catalogueLigneId, catalogueLignesTable.id),
      )
      .orderBy(desc(catalogueAliasTable.createdAt)),
  );
  res.json({ alias: lignes, total: lignes.length });
});

/**
 * POST /catalogue/alias — retient une CORRECTION de l'artisan.
 *
 * Appelée quand il a désigné lui-même la ligne qui convenait, jamais quand le
 * rapprochement a réussi tout seul. Le corps porte le libellé qu'il a DICTÉ et
 * la ligne qu'il a CHOISIE : les deux viennent de lui.
 */
router.post("/catalogue/alias", async (req, res): Promise<void> => {
  const parsed = z
    .object({
      // `.trim()` AVANT `.min(1)` : une chaîne d'espaces passait la validation
      // et n'était refusée que plus loin, avec un code qui parlait d'un
      // conflit d'état alors que c'est l'entrée qui est vide.
      libelleDicte: z.string().trim().min(1, "Le libellé dicté est obligatoire").max(300),
      catalogueLigneId: z.string().min(1),
      /** Remplacer un apprentissage antérieur — jamais implicite. */
      remplacer: z.boolean().default(false),
    })
    .safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;

  const resultat = await apprendreAlias(
    tenantId,
    parsed.data.libelleDicte,
    parsed.data.catalogueLigneId,
    { remplacer: parsed.data.remplacer },
  );

  if (!resultat.ok) {
    // 409 et non 400 : la demande est bien formée, c'est l'ÉTAT du catalogue
    // qui s'y oppose. Le message dit lequel, pour que l'artisan puisse décider.
    // 404 pour une cible absente, 400 pour une entrée vide, 409 sinon : la
    // demande est alors bien formée et c'est l'ÉTAT du catalogue qui s'y
    // oppose.
    const code =
      resultat.refus.motif === "ligne_introuvable" ? 404
      : resultat.refus.motif === "libelle_vide" ? 400
      : 409;
    res.status(code).json({ error: messageRefus(resultat.refus), motif: resultat.refus.motif });
    return;
  }

  res.status(201).json({ alias: resultat.alias, remplace: resultat.remplace });
});

/** DELETE /catalogue/alias/:id — oublier. Une erreur doit pouvoir se défaire. */
router.delete("/catalogue/alias/:id", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  const oublie = await oublierAlias(tenantId, typeof id === "string" ? id : "");
  if (!oublie) { res.status(404).json({ error: "Alias introuvable" }); return; }
  res.status(204).send();
});

export default router;
