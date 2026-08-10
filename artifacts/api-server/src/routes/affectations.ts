/**
 * Affectations — LE PRÉVU.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UNE HEURE PRÉVUE N'ENTRE JAMAIS DANS LE CALCUL D'UNE MARGE.             ║
 * ║  Le réalisé vit dans `pointages`, et lui seul compte.                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Ce module n'écrit RIEN dans `pointages` et n'est lu par aucun calcul de coût.
 * Il ne sert qu'à deux choses : savoir qui est prévu où, et PROPOSER un
 * récapitulatif de semaine que l'artisan confirmera — ou pas.
 *
 * Toutes les bornes sont des dates métier (`YYYY-MM-DD`), en composantes
 * locales. Jamais `toISOString`.
 */
import { Router, type IRouter } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { withTenant, affectationsTable } from "@workspace/db";

const router: IRouter = Router();

const DATE_METIER = /^\d{4}-\d{2}-\d{2}$/;

const AffectationBody = z.object({
  affaireId: z.string().min(1, "L'affaire est obligatoire"),
  membreId: z.string().min(1, "Le membre est obligatoire"),
  dateDebut: z.string().regex(DATE_METIER, "Date attendue au format AAAA-MM-JJ"),
  dateFin: z.string().regex(DATE_METIER, "Date attendue au format AAAA-MM-JJ"),
  heuresParJour: z.number().positive("Les heures par jour doivent être positives").max(24),
  joursOuvresSeulement: z.boolean().default(true),
});

const AffectationPatch = AffectationBody.partial();

/**
 * Une période qui finit avant de commencer n'est pas une période.
 *
 * La comparaison porte sur des chaînes `YYYY-MM-DD`, dont l'ordre
 * lexicographique EST l'ordre chronologique. Passer par `new Date` ici
 * réintroduirait un instant là où il n'y a qu'un jour.
 */
function periodeIncoherente(debut: string, fin: string): boolean {
  return fin < debut;
}

router.get("/affectations", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const parsed = z
    .object({
      debut: z.string().regex(DATE_METIER).optional(),
      fin: z.string().regex(DATE_METIER).optional(),
      membreId: z.string().optional(),
      affaireId: z.string().optional(),
    })
    .safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const f = parsed.data;

  const affectations = await withTenant(tenantId, (tx) => {
    // Recouvrement de périodes, et non inclusion : une affectation du 27 août
    // au 27 septembre concerne la semaine du 1er septembre. Filtrer sur
    // `date_debut BETWEEN` la manquerait.
    const conditions = [
      ...(f.fin ? [lte(affectationsTable.dateDebut, f.fin)] : []),
      ...(f.debut ? [gte(affectationsTable.dateFin, f.debut)] : []),
      ...(f.membreId ? [eq(affectationsTable.membreId, f.membreId)] : []),
      ...(f.affaireId ? [eq(affectationsTable.affaireId, f.affaireId)] : []),
    ];
    const q = tx.select().from(affectationsTable);
    return conditions.length > 0
      ? q.where(and(...conditions)).orderBy(affectationsTable.dateDebut)
      : q.orderBy(affectationsTable.dateDebut);
  });

  res.json({ affectations, total: affectations.length });
});

router.get("/affectations/:id", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  const [a] = await withTenant(tenantId, (tx) =>
    tx.select().from(affectationsTable).where(eq(affectationsTable.id, id!)),
  );
  if (!a) { res.status(404).json({ error: "Affectation introuvable" }); return; }
  res.json(a);
});

router.post("/affectations", async (req, res): Promise<void> => {
  const parsed = AffectationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;

  if (periodeIncoherente(d.dateDebut, d.dateFin)) {
    res.status(400).json({ error: "La date de fin ne peut pas précéder la date de début." });
    return;
  }

  const tenantId = req.tenantId!;
  const [cree] = await withTenant(tenantId, (tx) =>
    tx
      .insert(affectationsTable)
      .values({
        tenantId,
        affaireId: d.affaireId,
        membreId: d.membreId,
        dateDebut: d.dateDebut,
        dateFin: d.dateFin,
        heuresParJour: String(d.heuresParJour),
        joursOuvresSeulement: d.joursOuvresSeulement,
      })
      .returning(),
  );
  res.status(201).json(cree);
});

router.patch("/affectations/:id", async (req, res): Promise<void> => {
  const parsed = AffectationPatch.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const { id } = req.params;
  const d = parsed.data;

  const resultat = await withTenant(tenantId, async (tx) => {
    const [existant] = await tx
      .select()
      .from(affectationsTable)
      .where(eq(affectationsTable.id, id!));
    if (!existant) return { kind: "introuvable" as const };

    // Les bornes se contrôlent sur la valeur FINALE, pas sur celle envoyée :
    // ne changer que `dateFin` doit être refusé si elle passe avant le début
    // déjà enregistré.
    const debut = d.dateDebut ?? existant.dateDebut;
    const fin = d.dateFin ?? existant.dateFin;
    if (periodeIncoherente(debut, fin)) return { kind: "incoherente" as const };

    const [maj] = await tx
      .update(affectationsTable)
      .set({
        ...(d.affaireId !== undefined ? { affaireId: d.affaireId } : {}),
        ...(d.membreId !== undefined ? { membreId: d.membreId } : {}),
        ...(d.dateDebut !== undefined ? { dateDebut: d.dateDebut } : {}),
        ...(d.dateFin !== undefined ? { dateFin: d.dateFin } : {}),
        ...(d.heuresParJour !== undefined ? { heuresParJour: String(d.heuresParJour) } : {}),
        ...(d.joursOuvresSeulement !== undefined
          ? { joursOuvresSeulement: d.joursOuvresSeulement }
          : {}),
      })
      .where(eq(affectationsTable.id, id!))
      .returning();
    return { kind: "ok" as const, affectation: maj! };
  });

  if (resultat.kind === "introuvable") {
    res.status(404).json({ error: "Affectation introuvable" });
    return;
  }
  if (resultat.kind === "incoherente") {
    res.status(400).json({ error: "La date de fin ne peut pas précéder la date de début." });
    return;
  }
  res.json(resultat.affectation);
});

router.delete("/affectations/:id", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  const [supprime] = await withTenant(tenantId, (tx) =>
    tx.delete(affectationsTable).where(eq(affectationsTable.id, id!)).returning(),
  );
  if (!supprime) { res.status(404).json({ error: "Affectation introuvable" }); return; }
  res.status(204).send();
});

export default router;
