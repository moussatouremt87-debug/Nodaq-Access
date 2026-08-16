/**
 * Pointage des heures — par membre, par jour, rattaché à une affaire OU à un
 * client (US-A4.1 : un métier sans "chantier" pointe directement sur un
 * client, sans affaire fictive — cf. la contrainte CHECK de la migration 032).
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
  affectationsTable,
  clientsTable,
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

/**
 * Rattachement EXCLUSIF à une affaire OU à un client (US-A4.1) : un métier
 * sans "chantier" pointe directement sur un client, sans affaire fictive. La
 * contrainte CHECK du moteur (migration 032) fait autorité ; ce `.refine`
 * donne juste un 400 lisible avant d'y arriver.
 */
const RATTACHEMENT_EXCLUSIF_MESSAGE =
  "Le pointage doit être rattaché à une affaire OU à un client, jamais les deux ni aucun des deux.";

const CreatePointageBody = z
  .object({
    membreId: z.string().min(1),
    affaireId: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    date: z.string().regex(DATE_ISO, "Format attendu : YYYY-MM-DD"),
    heures: HeuresSchema,
    source: z.enum(["confirme", "saisi", "importe"]).optional().default("saisi"),
    commentaire: z.string().max(500).optional(),
  })
  .refine((d) => Boolean(d.affaireId) !== Boolean(d.clientId), {
    message: RATTACHEMENT_EXCLUSIF_MESSAGE,
  });

const UpdatePointageBody = z.object({
  heures: HeuresSchema.optional(),
  commentaire: z.string().max(500).nullable().optional(),
});

const ListQuery = z.object({
  debut: z.string().regex(DATE_ISO).optional(),
  fin: z.string().regex(DATE_ISO).optional(),
  affaireId: z.string().optional(),
  clientId: z.string().optional(),
  membreId: z.string().optional(),
});

const ConfirmerBody = z.object({
  /** N'importe quelle date de la semaine visée. */
  date: z.string().regex(DATE_ISO),
  lignes: z
    .array(
      z
        .object({
          membreId: z.string().min(1),
          affaireId: z.string().min(1).optional(),
          clientId: z.string().min(1).optional(),
          date: z.string().regex(DATE_ISO),
          heures: z.coerce.number().min(0).max(24),
        })
        .refine((l) => Boolean(l.affaireId) !== Boolean(l.clientId), {
          message: RATTACHEMENT_EXCLUSIF_MESSAGE,
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
  const { debut, fin, affaireId, clientId, membreId } = parsed.data;
  const tenantId = req.tenantId!;

  const rows = await withTenant(tenantId, (tx) => {
    const conditions = [
      debut ? gte(pointagesTable.date, debut) : undefined,
      fin ? lte(pointagesTable.date, fin) : undefined,
      affaireId ? eq(pointagesTable.affaireId, affaireId) : undefined,
      clientId ? eq(pointagesTable.clientId, clientId) : undefined,
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
    const clients = await tx.select().from(clientsTable);
    const absences = await tx.select().from(absencesTable);
    const existants = await tx
      .select()
      .from(pointagesTable)
      .where(and(gte(pointagesTable.date, debut), lte(pointagesTable.date, fin)));
    // Affectations qui RECOUVRENT la semaine, et non celles qui y commencent :
    // une affectation du 27 août au 27 septembre concerne la semaine du
    // 1er septembre sans y débuter.
    const affectations = await tx
      .select()
      .from(affectationsTable)
      .where(and(
        lte(affectationsTable.dateDebut, fin),
        gte(affectationsTable.dateFin, debut),
      ));
    return { membres, affaires, clients, absences, existants, affectations };
  });

  const affairesActives = new Map(
    data.affaires.filter((a) => STATUTS_ACTIFS.includes(a.status)).map((a) => [a.id, a]),
  );
  // Un client archivé ne doit plus être proposé pour du nouveau temps — au
  // même titre qu'une affaire non EN_COURS/ACCEPTEE ci-dessus.
  const clientsActifs = new Map(data.clients.filter((c) => !c.archive).map((c) => [c.id, c]));

  /** Un membre est-il absent ce jour-là ? */
  const estAbsent = (membreId: string, jour: string): boolean =>
    data.absences.some(
      (a) => a.membreId === membreId && a.dateDebut <= jour && jour <= a.dateFin,
    );

  /**
   * Clé de rattachement — EXCLUSIVE (US-A4.1) : une ligne pointe soit sur une
   * affaire, soit sur un client, jamais les deux. Préfixée pour qu'une
   * affaire et un client de même id (hasard) ne collisionnent jamais.
   */
  const cleRattachement = (affaireId: string | null, clientId: string | null): string =>
    affaireId ? `a:${affaireId}` : `c:${clientId}`;

  // Ce qui est déjà pointé fait autorité sur la proposition.
  const dejaPointe = new Map(
    data.existants.map((p) => [
      `${p.membreId}|${cleRattachement(p.affaireId, p.clientId)}|${p.date}`,
      p,
    ]),
  );

  const lignes: Array<{
    membreId: string;
    membreNom: string;
    affaireId: string | null;
    affaireLabel: string | null;
    clientId: string | null;
    clientLabel: string | null;
    date: string;
    heures: number;
    origine: "pointe" | "propose";
  }> = [];

  for (const membre of data.membres) {
    if (membre.availability === "ABSENT") continue;

    let planning: Array<{ day: string; affaireId: string | null; clientId?: string | null }> = [];
    try {
      planning = JSON.parse(membre.schedule) as typeof planning;
    } catch {
      planning = [];
    }

    // 7 jours, PAS JOURS_OUVRES.length : bornesSemaine rend une semaine
    // complète (lundi→dimanche), affectations et pointages sont interrogés
    // sur cette même plage — mais une boucle bornée à 5 ne générait jamais
    // samedi ni dimanche comme `jour` candidat. Une affectation posée pour un
    // week-end (fréquent en bâtiment) disparaissait donc silencieusement de
    // la proposition, jamais montrée, jamais confirmable — quelle qu'ait été
    // l'intention de qui l'a créée. `JOURS_OUVRES[i]` reste `undefined`
    // au-delà de l'index 4 : la SEMAINE TYPE, elle, ne propose toujours rien
    // par défaut le week-end — seule une affectation explicite le peut,
    // et seulement si elle a choisi de couvrir le week-end (voir plus bas).
    for (let i = 0; i < 7; i++) {
      const jourDate = new Date(`${debut}T12:00:00`);
      jourDate.setDate(jourDate.getDate() + i);
      const jour = toDateString(jourDate);
      const weekEnd = jourDate.getDay() === 0 || jourDate.getDay() === 6;
      if (estAbsent(membre.id, jour)) continue;

      // L'AFFECTATION L'EMPORTE SUR LA SEMAINE TYPE.
      //
      // La semaine type est un défaut : « Thomas est au carrelage le mardi ».
      // Une affectation est une décision datée : « Thomas est sur ce chantier
      // du 27 août au 27 septembre ». Quand les deux existent, c'est la
      // décision qui vaut — sinon l'artisan qui vient de planifier son mois
      // verrait le produit lui proposer autre chose.
      //
      // Elle reste une PROPOSITION : rien n'est écrit tant que
      // `POST .../confirmer` n'a pas eu lieu. Une heure prévue n'entre dans
      // aucune marge.
      //
      // `joursOuvresSeulement` (colonne dédiée, vraie par défaut) est
      // l'INTENTION posée à la création de l'affectation — une décision
      // explicite « y compris le week-end » (joursOuvresSeulement: false)
      // doit rester visible un samedi ou un dimanche ; le défaut, lui, ne
      // doit pas se mettre à proposer des heures que personne n'a demandées.
      const affectationsDuJour = data.affectations.filter(
        (a) =>
          a.membreId === membre.id &&
          a.dateDebut <= jour &&
          jour <= a.dateFin &&
          !(weekEnd && a.joursOuvresSeulement),
      );

      const creneau = planning.find((p) => p.day === JOURS_OUVRES[i]);
      const candidats: Array<{ affaireId: string | null; clientId: string | null; heures: number }> =
        affectationsDuJour.length > 0
          ? affectationsDuJour.map((a) => ({
              affaireId: a.affaireId,
              clientId: a.clientId,
              heures: Number(a.heuresParJour),
            }))
          : creneau?.affaireId
            ? [{ affaireId: creneau.affaireId, clientId: null, heures: HEURES_PAR_JOUR_STANDARD }]
            : creneau?.clientId
              ? [{ affaireId: null, clientId: creneau.clientId, heures: HEURES_PAR_JOUR_STANDARD }]
              : [];

      for (const candidat of candidats) {
        let affaireLabel: string | null = null;
        let clientLabel: string | null = null;
        if (candidat.affaireId) {
          const affaire = affairesActives.get(candidat.affaireId);
          if (!affaire) continue;
          affaireLabel = affaire.label;
        } else if (candidat.clientId) {
          const client = clientsActifs.get(candidat.clientId);
          if (!client) continue;
          clientLabel = client.nom;
        } else {
          continue;
        }

        const cle = `${membre.id}|${cleRattachement(candidat.affaireId, candidat.clientId)}|${jour}`;
        const existant = dejaPointe.get(cle);
        lignes.push({
          membreId: membre.id,
          membreNom: membre.name,
          affaireId: candidat.affaireId,
          affaireLabel,
          clientId: candidat.clientId,
          clientLabel,
          date: jour,
          heures: existant ? heuresEnNombre(existant.heures) : candidat.heures,
          origine: existant ? "pointe" : "propose",
        });
      }
    }
  }

  // Les pointages hors planning (saisis à la main) ne doivent pas disparaître
  // du récapitulatif : sinon une confirmation les effacerait sans le dire.
  for (const p of data.existants) {
    const cle = `${p.membreId}|${cleRattachement(p.affaireId, p.clientId)}|${p.date}`;
    if (
      lignes.some(
        (l) => `${l.membreId}|${cleRattachement(l.affaireId, l.clientId)}|${l.date}` === cle,
      )
    )
      continue;
    const membre = data.membres.find((m) => m.id === p.membreId);
    const affaire = p.affaireId ? data.affaires.find((a) => a.id === p.affaireId) : undefined;
    const client = p.clientId ? data.clients.find((c) => c.id === p.clientId) : undefined;
    lignes.push({
      membreId: p.membreId,
      membreNom: membre?.name ?? "—",
      affaireId: p.affaireId,
      affaireLabel: p.affaireId ? (affaire?.label ?? "—") : null,
      clientId: p.clientId,
      clientLabel: p.clientId ? (client?.nom ?? "—") : null,
      date: p.date,
      heures: heuresEnNombre(p.heures),
      origine: "pointe",
    });
  }

  lignes.sort((a, b) => a.date.localeCompare(b.date) || a.membreNom.localeCompare(b.membreNom));

  const totalHeures = lignes.reduce((acc, l) => acc + l.heures, 0);
  const parAffaire = [...
    lignes
      .filter((l) => l.affaireId !== null)
      .reduce((acc, l) => {
        const cur = acc.get(l.affaireId!) ?? { affaireId: l.affaireId!, affaireLabel: l.affaireLabel!, heures: 0 };
        cur.heures += l.heures;
        acc.set(l.affaireId!, cur);
        return acc;
      }, new Map<string, { affaireId: string; affaireLabel: string; heures: number }>())
      .values()];
  const parClient = [...
    lignes
      .filter((l) => l.clientId !== null)
      .reduce((acc, l) => {
        const cur = acc.get(l.clientId!) ?? { clientId: l.clientId!, clientLabel: l.clientLabel!, heures: 0 };
        cur.heures += l.heures;
        acc.set(l.clientId!, cur);
        return acc;
      }, new Map<string, { clientId: string; clientLabel: string; heures: number }>())
      .values()];

  res.json({ semaine: { debut, fin }, lignes, parAffaire, parClient, totalHeures });
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

  // Une semaine à venir n'a pas eu lieu : personne n'y a travaillé. Accepter ces
  // heures ferait entrer dans la marge par affaire du temps que personne n'a
  // passé — exactement l'indicateur que le pointage doit rendre vrai.
  //
  // La garde est ICI et pas seulement dans l'interface : désactiver un bouton
  // n'empêche pas un appel direct, et c'est la base qui porte la conséquence.
  // Bornes comparées en composantes locales via bornesSemaine/toDateString,
  // jamais via toISOString.
  const { debut: lundiCourant } = bornesSemaine(new Date());
  if (debut > lundiCourant) {
    res.status(400).json({ error: "Cette semaine n'a pas encore eu lieu." });
    return;
  }

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
      // Exactement un des deux est renseigné (Zod `.refine` ci-dessus) : la
      // clé de recherche porte sur celui-là. Un rattachement affaire ne peut
      // matcher qu'une ligne existante à affaire_id égal — le CHECK exclusif
      // du moteur garantit que cette ligne, si elle existe, a client_id NULL.
      const rattachement = ligne.affaireId
        ? eq(pointagesTable.affaireId, ligne.affaireId)
        : eq(pointagesTable.clientId, ligne.clientId!);
      const cle = and(
        eq(pointagesTable.membreId, ligne.membreId),
        rattachement,
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
          affaireId: ligne.affaireId ?? null,
          clientId: ligne.clientId ?? null,
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
          affaireId: d.affaireId ?? null,
          clientId: d.clientId ?? null,
          date: d.date,
          heures: d.heures.toFixed(2),
          source: d.source,
          ...(d.commentaire ? { commentaire: d.commentaire } : {}),
        })
        .returning(),
    );
    res.status(201).json({ ...cree!, heures: heuresEnNombre(cree!.heures) });
  } catch (err) {
    // Un pointage existe déjà pour ce membre, sur ce rattachement, ce jour-là.
    // On le dit plutôt que d'écraser en silence.
    if (estViolationUnicite(err)) {
      res.status(409).json({
        error: "Un pointage existe déjà pour ce membre, ce rattachement et ce jour. Modifiez-le.",
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
