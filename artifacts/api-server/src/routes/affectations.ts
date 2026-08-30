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
import { messageValidation } from "../lib/message-validation.js";

const router: IRouter = Router();

const DATE_METIER = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rattachement EXCLUSIF à une affaire OU à un client (US-A4.1) : un métier
 * sans "chantier" doit pouvoir affecter un membre directement à un client,
 * sans créer d'affaire fictive. `.refine` reproduit ici la contrainte CHECK
 * du moteur (migration 032) — la base fait autorité, ce refine ne fait que
 * donner une erreur 400 lisible avant d'y arriver.
 */
const AffectationBody = z
  .object({
    affaireId: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    membreId: z.string().min(1, "Le membre est obligatoire"),
    dateDebut: z.string().regex(DATE_METIER, "Date attendue au format AAAA-MM-JJ"),
    dateFin: z.string().regex(DATE_METIER, "Date attendue au format AAAA-MM-JJ"),
    heuresParJour: z.number().positive("Les heures par jour doivent être positives").max(24),
    joursOuvresSeulement: z.boolean().default(true),
  })
  .refine((d) => Boolean(d.affaireId) !== Boolean(d.clientId), {
    message: "L'affectation doit être rattachée à une affaire OU à un client, jamais les deux ni aucun des deux.",
  });

// Le PATCH accepte `null` explicite pour BASCULER de rattachement (passer
// d'une affaire à un client ou inversement) : un champ absent du corps
// conserve la valeur existante (voir la route), un champ envoyé à `null` la
// vide délibérément. La cohérence finale (exactement un rattachement) se
// vérifie contre l'état FUSIONNÉ existant+patch dans la route, sur le même
// principe que `periodeIncoherente` ci-dessus pour les dates.
const AffectationPatch = z.object({
  affaireId: z.string().min(1).nullable().optional(),
  clientId: z.string().min(1).nullable().optional(),
  membreId: z.string().min(1).optional(),
  dateDebut: z.string().regex(DATE_METIER).optional(),
  dateFin: z.string().regex(DATE_METIER).optional(),
  heuresParJour: z.number().positive().max(24).optional(),
  joursOuvresSeulement: z.boolean().optional(),
});

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
      clientId: z.string().optional(),
    })
    .safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
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
      ...(f.clientId ? [eq(affectationsTable.clientId, f.clientId)] : []),
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
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
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
        affaireId: d.affaireId ?? null,
        clientId: d.clientId ?? null,
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
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
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

    // Même principe pour le rattachement : un champ absent du patch conserve
    // la valeur existante, un `null` explicite la vide (bascule affaire→client
    // ou l'inverse). C'est l'état FUSIONNÉ qui doit satisfaire « exactement
    // un des deux » — la contrainte CHECK du moteur (migration 032) le
    // vérifierait de toute façon, mais un 400 lisible vaut mieux qu'une
    // erreur Postgres brute.
    const affaireIdFinal = d.affaireId !== undefined ? d.affaireId : existant.affaireId;
    const clientIdFinal = d.clientId !== undefined ? d.clientId : existant.clientId;
    if (Boolean(affaireIdFinal) === Boolean(clientIdFinal)) {
      return { kind: "rattachement_invalide" as const };
    }

    const [maj] = await tx
      .update(affectationsTable)
      .set({
        ...(d.affaireId !== undefined ? { affaireId: d.affaireId } : {}),
        ...(d.clientId !== undefined ? { clientId: d.clientId } : {}),
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
  if (resultat.kind === "rattachement_invalide") {
    res.status(400).json({
      error: "L'affectation doit être rattachée à une affaire OU à un client, jamais les deux ni aucun des deux.",
    });
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
