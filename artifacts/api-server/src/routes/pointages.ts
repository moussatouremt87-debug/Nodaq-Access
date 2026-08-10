/**
 * Pointage des heures — par membre, par affaire, par jour.
 *
 * Principe d'interaction : l'artisan ne SAISIT pas des heures, il CONFIRME un
 * récapitulatif. `GET /pointages/recapitulatif-semaine` rend une proposition
 * pré-remplie depuis le planning de l'équipe et les affaires en cours ;
 * `POST .../confirmer` l'enregistre après ajustement. La saisie unitaire reste
 * possible mais n'est pas le chemin principal.
 *
 * Toutes les bornes de semaine passent par `bornesSemaine` (composantes
 * locales) : une borne dérivée d'un toISOString rangerait le lundi dans la
 * semaine précédente près de minuit.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import {
  withTenant,
  pointagesTable,
  teamMembersTable,
  affairesTable,
  absencesTable,
} from "@workspace/db";
import { toDateString, bornesSemaine, HEURES_PAR_JOUR_STANDARD } from "@nodaq/shared";

const router: IRouter = Router();

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Jours ouvrés du planning, dans l'ordre de la semaine ISO. */
const JOURS_OUVRES = ["LUN", "MAR", "MER", "JEU", "VEN"] as const;

/** Affaires sur lesquelles du temps peut être pointé. */
const STATUTS_ACTIFS = ["EN_COURS", "ACCEPTEE"];

// ── Schémas ───────────────────────────────────────────────────────────────────

const HeuresSchema = z.coerce
  .number()
  .positive("Les heures doivent être strictement positives")
  .max(24, "Une journée ne dépasse pas 24 heures");

const CreatePointageBody = z.object({
  membreId: z.string().min(1),
  affaireId: z.string().min(1),
  date: z.string().regex(DATE_ISO, "Format attendu : YYYY-MM-DD"),
  heures: HeuresSchema,
  source: z.enum(["confirme", "saisi", "importe"]).optional().default("saisi"),
  commentaire: z.string().max(500).optional(),
});

const UpdatePointageBody = z.object({
  heures: HeuresSchema.optional(),
  commentaire: z.string().max(500).nullable().optional(),
});

const ListQuery = z.object({
  debut: z.string().regex(DATE_ISO).optional(),
  fin: z.string().regex(DATE_ISO).optional(),
  affaireId: z.string().optional(),
  membreId: z.string().optional(),
});

const ConfirmerBody = z.object({
  /** N'importe quelle date de la semaine visée. */
  date: z.string().regex(DATE_ISO),
  lignes: z
    .array(
      z.object({
        membreId: z.string().min(1),
        affaireId: z.string().min(1),
        date: z.string().regex(DATE_ISO),
        heures: z.coerce.number().min(0).max(24),
      }),
    )
    .max(500),
});

/** `numeric` revient en chaîne depuis PostgreSQL : on parse, on ne coerce pas. */
function heuresEnNombre(v: string | number | null): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

/**
 * Violation de contrainte d'unicité PostgreSQL (23505) ?
 *
 * Drizzle ENVELOPPE l'erreur du pilote : le code ne se trouve pas sur l'objet
 * levé mais plus bas dans la chaîne des `cause`. Ne tester que le premier
 * niveau renvoyait un 500 générique là où l'utilisateur doit lire « ce
 * pointage existe déjà ».
 */
function estViolationUnicite(err: unknown): boolean {
  let courant: unknown = err;
  for (let profondeur = 0; courant !== null && courant !== undefined && profondeur < 5; profondeur++) {
    if ((courant as { code?: string }).code === "23505") return true;
    courant = (courant as { cause?: unknown }).cause;
  }
  return false;
}

// ── Lecture ───────────────────────────────────────────────────────────────────

/** GET /pointages — par période, par affaire, par membre. */
router.get("/pointages", async (req, res): Promise<void> => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { debut, fin, affaireId, membreId } = parsed.data;
  const tenantId = req.tenantId!;

  const rows = await withTenant(tenantId, (tx) => {
    const conditions = [
      debut ? gte(pointagesTable.date, debut) : undefined,
      fin ? lte(pointagesTable.date, fin) : undefined,
      affaireId ? eq(pointagesTable.affaireId, affaireId) : undefined,
      membreId ? eq(pointagesTable.membreId, membreId) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const base = tx.select().from(pointagesTable);
    return (conditions.length > 0 ? base.where(and(...conditions)) : base).orderBy(
      desc(pointagesTable.date),
    );
  });

  const pointages = rows.map((p) => ({ ...p, heures: heuresEnNombre(p.heures) }));
  const totalHeures = pointages.reduce((acc, p) => acc + p.heures, 0);
  res.json({ pointages, total: pointages.length, totalHeures });
});

/**
 * GET /pointages/recapitulatif-semaine?date=YYYY-MM-DD
 *
 * Rend la proposition pré-remplie de la semaine : une ligne par membre et par
 * affaire, alimentée par le planning, amputée des absences, et ÉCRASÉE par ce
 * qui a déjà été pointé — rouvrir la semaine montre ce qui a été confirmé, pas
 * une proposition qui contredirait l'enregistrement.
 */
router.get("/pointages/recapitulatif-semaine", async (req, res): Promise<void> => {
  const dateParam = typeof req.query["date"] === "string" ? req.query["date"] : undefined;
  if (dateParam !== undefined && !DATE_ISO.test(dateParam)) {
    res.status(400).json({ error: "Format attendu : YYYY-MM-DD" });
    return;
  }
  // Sans date fournie, la semaine en cours — bornes en heure LOCALE.
  const reference = dateParam ? new Date(`${dateParam}T12:00:00`) : new Date();
  const { debut, fin } = bornesSemaine(reference);
  const tenantId = req.tenantId!;

  const data = await withTenant(tenantId, async (tx) => {
    const membres = await tx.select().from(teamMembersTable);
    const affaires = await tx.select().from(affairesTable);
    const absences = await tx.select().from(absencesTable);
    const existants = await tx
      .select()
      .from(pointagesTable)
      .where(and(gte(pointagesTable.date, debut), lte(pointagesTable.date, fin)));
    return { membres, affaires, absences, existants };
  });

  const affairesActives = new Map(
    data.affaires.filter((a) => STATUTS_ACTIFS.includes(a.status)).map((a) => [a.id, a]),
  );

  /** Un membre est-il absent ce jour-là ? */
  const estAbsent = (membreId: string, jour: string): boolean =>
    data.absences.some(
      (a) => a.membreId === membreId && a.dateDebut <= jour && jour <= a.dateFin,
    );

  // Ce qui est déjà pointé fait autorité sur la proposition.
  const dejaPointe = new Map(
    data.existants.map((p) => [`${p.membreId}|${p.affaireId}|${p.date}`, p]),
  );

  const lignes: Array<{
    membreId: string;
    membreNom: string;
    affaireId: string;
    affaireLabel: string;
    date: string;
    heures: number;
    origine: "pointe" | "propose";
  }> = [];

  for (const membre of data.membres) {
    if (membre.availability === "ABSENT") continue;

    let planning: Array<{ day: string; affaireId: string | null }> = [];
    try {
      planning = JSON.parse(membre.schedule) as typeof planning;
    } catch {
      planning = [];
    }

    for (let i = 0; i < JOURS_OUVRES.length; i++) {
      const jourDate = new Date(`${debut}T12:00:00`);
      jourDate.setDate(jourDate.getDate() + i);
      const jour = toDateString(jourDate);
      if (estAbsent(membre.id, jour)) continue;

      const creneau = planning.find((p) => p.day === JOURS_OUVRES[i]);
      const affaireId = creneau?.affaireId ?? null;
      if (!affaireId) continue;

      const affaire = affairesActives.get(affaireId);
      if (!affaire) continue;

      const cle = `${membre.id}|${affaireId}|${jour}`;
      const existant = dejaPointe.get(cle);
      lignes.push({
        membreId: membre.id,
        membreNom: membre.name,
        affaireId,
        affaireLabel: affaire.label,
        date: jour,
        heures: existant ? heuresEnNombre(existant.heures) : HEURES_PAR_JOUR_STANDARD,
        origine: existant ? "pointe" : "propose",
      });
    }
  }

  // Les pointages hors planning (saisis à la main) ne doivent pas disparaître
  // du récapitulatif : sinon une confirmation les effacerait sans le dire.
  for (const p of data.existants) {
    const cle = `${p.membreId}|${p.affaireId}|${p.date}`;
    if (lignes.some((l) => `${l.membreId}|${l.affaireId}|${l.date}` === cle)) continue;
    const membre = data.membres.find((m) => m.id === p.membreId);
    const affaire = data.affaires.find((a) => a.id === p.affaireId);
    lignes.push({
      membreId: p.membreId,
      membreNom: membre?.name ?? "—",
      affaireId: p.affaireId,
      affaireLabel: affaire?.label ?? "—",
      date: p.date,
      heures: heuresEnNombre(p.heures),
      origine: "pointe",
    });
  }

  lignes.sort((a, b) => a.date.localeCompare(b.date) || a.membreNom.localeCompare(b.membreNom));

  const totalHeures = lignes.reduce((acc, l) => acc + l.heures, 0);
  const parAffaire = [...
    lignes.reduce((acc, l) => {
      const cur = acc.get(l.affaireId) ?? { affaireId: l.affaireId, affaireLabel: l.affaireLabel, heures: 0 };
      cur.heures += l.heures;
      acc.set(l.affaireId, cur);
      return acc;
    }, new Map<string, { affaireId: string; affaireLabel: string; heures: number }>())
      .values()];

  res.json({ semaine: { debut, fin }, lignes, parAffaire, totalHeures });
});

// ── Écriture ──────────────────────────────────────────────────────────────────

/**
 * POST /pointages/recapitulatif-semaine/confirmer
 *
 * Enregistre la semaine ajustée. Idempotent grâce à la contrainte d'unicité :
 * reconfirmer met à jour au lieu de dupliquer. Une ligne à 0 heure SUPPRIME le
 * pointage — c'est ainsi que l'utilisateur retire une affaire du récapitulatif.
 */
router.post("/pointages/recapitulatif-semaine/confirmer", async (req, res): Promise<void> => {
  const parsed = ConfirmerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { date, lignes } = parsed.data;
  const { debut, fin } = bornesSemaine(new Date(`${date}T12:00:00`));

  // Une ligne hors de la semaine annoncée est refusée : accepter silencieusement
  // laisserait écrire n'importe quelle date sous couvert d'une confirmation.
  const horsSemaine = lignes.filter((l) => l.date < debut || l.date > fin);
  if (horsSemaine.length > 0) {
    res.status(400).json({
      error: `${horsSemaine.length} ligne(s) hors de la semaine ${debut} → ${fin}`,
    });
    return;
  }

  const tenantId = req.tenantId!;
  const resultat = await withTenant(tenantId, async (tx) => {
    let ecrits = 0;
    let supprimes = 0;

    for (const ligne of lignes) {
      const cle = and(
        eq(pointagesTable.membreId, ligne.membreId),
        eq(pointagesTable.affaireId, ligne.affaireId),
        eq(pointagesTable.date, ligne.date),
      );

      if (ligne.heures <= 0) {
        await tx.delete(pointagesTable).where(cle);
        supprimes += 1;
        continue;
      }

      const [existant] = await tx.select().from(pointagesTable).where(cle);
      if (existant) {
        await tx
          .update(pointagesTable)
          .set({ heures: ligne.heures.toFixed(2), source: "confirme" })
          .where(eq(pointagesTable.id, existant.id));
      } else {
        await tx.insert(pointagesTable).values({
          tenantId,
          membreId: ligne.membreId,
          affaireId: ligne.affaireId,
          date: ligne.date,
          heures: ligne.heures.toFixed(2),
          source: "confirme",
        });
      }
      ecrits += 1;
    }

    return { ecrits, supprimes };
  });

  res.json({ semaine: { debut, fin }, ...resultat });
});

/** POST /pointages — saisie unitaire. */
router.post("/pointages", async (req, res): Promise<void> => {
  const parsed = CreatePointageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const tenantId = req.tenantId!;

  try {
    const [cree] = await withTenant(tenantId, (tx) =>
      tx
        .insert(pointagesTable)
        .values({
          tenantId,
          membreId: d.membreId,
          affaireId: d.affaireId,
          date: d.date,
          heures: d.heures.toFixed(2),
          source: d.source,
          ...(d.commentaire ? { commentaire: d.commentaire } : {}),
        })
        .returning(),
    );
    res.status(201).json({ ...cree!, heures: heuresEnNombre(cree!.heures) });
  } catch (err) {
    // Un pointage existe déjà pour ce membre, sur cette affaire, ce jour-là.
    // On le dit plutôt que d'écraser en silence.
    if (estViolationUnicite(err)) {
      res.status(409).json({
        error: "Un pointage existe déjà pour ce membre, cette affaire et ce jour. Modifiez-le.",
      });
      return;
    }
    throw err;
  }
});

/** PATCH /pointages/:id */
router.patch("/pointages/:id", async (req, res): Promise<void> => {
  const parsed = UpdatePointageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const id = req.params["id"] as string;
  const tenantId = req.tenantId!;

  const update: Record<string, unknown> = {};
  if (d.heures !== undefined) update["heures"] = d.heures.toFixed(2);
  if (d.commentaire !== undefined) update["commentaire"] = d.commentaire;
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "Aucun champ à modifier" });
    return;
  }

  const [modifie] = await withTenant(tenantId, (tx) =>
    tx.update(pointagesTable).set(update).where(eq(pointagesTable.id, id)).returning(),
  );
  if (!modifie) {
    res.status(404).json({ error: "Pointage introuvable" });
    return;
  }
  res.json({ ...modifie, heures: heuresEnNombre(modifie.heures) });
});

/** DELETE /pointages/:id */
router.delete("/pointages/:id", async (req, res): Promise<void> => {
  const id = req.params["id"] as string;
  const tenantId = req.tenantId!;

  const [supprime] = await withTenant(tenantId, (tx) =>
    tx.delete(pointagesTable).where(eq(pointagesTable.id, id)).returning(),
  );
  if (!supprime) {
    res.status(404).json({ error: "Pointage introuvable" });
    return;
  }
  res.status(204).send();
});

export default router;
