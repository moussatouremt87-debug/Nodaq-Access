import { Router, type IRouter } from "express";
import { withTenant, DrizzleTx, teamMembersTable, affairesTable, facturesTable, settingsTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { toDateString } from "@nodaq/shared";
import {
  buildSemaines,
  calcHorizon,
  calcDevisEnAttente,
  calcJournees,
  simulerChantier,
  parseDate,
  type MemberRecord,
  type AbsenceRecord,
  type AffaireRecord,
} from "../services/planning-service";

/**
 * planning-service.ts does all of its internal calendar arithmetic in UTC
 * (getMondayOf, addDays, toISODate — deliberately, to avoid DST off-by-ones).
 * That's only correct if the "today" fed into it already represents the
 * right LOCAL (Europe/Paris) calendar day. `new Date()` is a real instant —
 * converting it straight to a UTC day (as toISODate does) can land on the
 * wrong day near local midnight. Normalize once here: read today's date from
 * LOCAL components, then re-anchor to UTC midnight for the module's
 * UTC-pure pipeline.
 */
function todayForPlanning(): Date {
  return parseDate(toDateString(new Date()));
}

const router: IRouter = Router();

const SEED_MEMBERS = [
  { name: "Sophie Marchand", role: "Développeuse Full-Stack", email: "sophie@nodaq.fr", availability: "DISPONIBLE" },
  { name: "Thomas Dubois",   role: "Designer UX/UI",         email: "thomas@nodaq.fr", availability: "PARTIEL" },
  { name: "Amel Benali",     role: "Chef de projet",         email: "amel@nodaq.fr",   availability: "DISPONIBLE" },
] as const;

const DAYS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];

async function getSetting(tx: DrizzleTx, key: string): Promise<string | null> {
  const result = await tx.execute(sql`SELECT value FROM settings WHERE key = ${key}`);
  return (result.rows[0] as any)?.value ?? null;
}

async function setSetting(tx: DrizzleTx, key: string, value: string, tenantId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO settings (tenant_id, key, value)
    VALUES (${tenantId}::uuid, ${key}, ${value})
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = ${value}, updated_at = NOW()
  `);
}

async function ensureDefaultMembers(tenantId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const existing = await tx.select().from(teamMembersTable);
    if (existing.length === 0) {
      for (const m of SEED_MEMBERS) {
        await tx.insert(teamMembersTable).values({
          tenantId, name: m.name, role: m.role, email: m.email,
          availability: m.availability,
          schedule: JSON.stringify(DAYS.map(day => ({ day, affaireId: null }))),
        });
      }
    }
  });
}

const CreateMemberBody = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  email: z.string().email().optional(),
  availability: z.enum(["DISPONIBLE", "PARTIEL", "ABSENT"]).optional(),
  schedule: z.array(z.object({ day: z.string(), affaireId: z.string().nullable() })).optional(),
});

const UpdateMemberBody = CreateMemberBody.partial();

const WEEK_COUNT = 10;

// ── Members ────────────────────────────────────────────────────────────────

router.get("/equipe", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  await ensureDefaultMembers(tenantId);

  const members = await withTenant(tenantId, async (tx) =>
    tx.select().from(teamMembersTable).orderBy(asc(teamMembersTable.createdAt))
  );

  const parsed = members.map(m => ({
    ...m,
    schedule: (() => { try { return JSON.parse(m.schedule); } catch { return []; } })(),
  }));
  res.json(parsed);
});

router.post("/equipe", async (req, res): Promise<void> => {
  const parsed = CreateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { name, role = "Collaborateur", email, availability = "DISPONIBLE", schedule = [] } = parsed.data;
  const tenantId = req.tenantId!;

  const [member] = await withTenant(tenantId, async (tx) =>
    tx.insert(teamMembersTable).values({
      tenantId, name, role, availability,
      schedule: JSON.stringify(schedule),
      ...(email ? { email } : {}),
    }).returning()
  );

  res.status(201).json({ ...member, schedule: JSON.parse(member!.schedule) });
});

router.patch("/equipe/:id", async (req, res): Promise<void> => {
  const { id } = req.params as { id: string };
  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const tenantId = req.tenantId!;

  const updated = await withTenant(tenantId, async (tx) => {
    const [existing] = await tx.select().from(teamMembersTable).where(eq(teamMembersTable.id, id));
    if (!existing) return null;

    const updateData: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
    if (parsed.data.email !== undefined) updateData.email = parsed.data.email;
    if (parsed.data.availability !== undefined) updateData.availability = parsed.data.availability;
    if (parsed.data.schedule !== undefined) updateData.schedule = JSON.stringify(parsed.data.schedule);

    const [updated] = await tx.update(teamMembersTable)
      .set(updateData as any)
      .where(eq(teamMembersTable.id, id))
      .returning();
    return updated;
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...updated, schedule: (() => { try { return JSON.parse(updated.schedule); } catch { return []; } })() });
});

router.delete("/equipe/:id", async (req, res): Promise<void> => {
  const { id } = req.params as { id: string };
  const tenantId = req.tenantId!;

  const [deleted] = await withTenant(tenantId, async (tx) =>
    tx.delete(teamMembersTable).where(eq(teamMembersTable.id, id)).returning()
  );
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

// ── Planning ──────────────────────────────────────────────────────────────

async function fetchPlanningData(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const tauxRaw = await getSetting(tx, "equipe.tauxJourFacture");
    const coutRaw = await getSetting(tx, "equipe.coutJourCharge");
    const tauxJourFacture = tauxRaw !== null ? Number(tauxRaw) : null;
    const coutJourCharge  = coutRaw !== null ? Number(coutRaw) : null;

    const rawMembers = await tx.select().from(teamMembersTable).orderBy(asc(teamMembersTable.createdAt));

    let absences: AbsenceRecord[] = [];
    try {
      const absResult = await tx.execute(sql`
        SELECT membre_id AS "membreId", date_debut::text AS "dateDebut", date_fin::text AS "dateFin"
        FROM absences WHERE tenant_id = ${tenantId}::uuid AND date_fin >= CURRENT_DATE
      `);
      absences = absResult.rows as AbsenceRecord[];
    } catch { /* degrade gracefully */ }

    const rawAffaires = await tx.select().from(affairesTable);
    const invoices    = await tx.select().from(facturesTable);

    return { tauxJourFacture, coutJourCharge, rawMembers, absences, rawAffaires, invoices };
  });
}

router.get("/equipe/plannings", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  await ensureDefaultMembers(tenantId);

  const { tauxJourFacture, coutJourCharge, rawMembers, absences, rawAffaires, invoices } =
    await fetchPlanningData(tenantId);

  const parametresManquants = tauxJourFacture === null || coutJourCharge === null;
  const taux = tauxJourFacture ?? 0.7;
  const cout = coutJourCharge ?? 250;

  const members: MemberRecord[] = rawMembers.map(m => ({
    id: m.id, name: m.name, availability: m.availability,
    schedule: (() => { try { return JSON.parse(m.schedule); } catch { return []; } })(),
  }));
  const activeCount = members.filter(m => m.availability !== "ABSENT").length;

  const affaires: AffaireRecord[] = rawAffaires.map(a => ({
    id: a.id, label: a.label, status: a.status,
    quotedAmountCents: a.quotedAmountCents ?? null,
    startDate: a.startDate ?? null, completedAt: a.completedAt ?? null,
  }));

  const today = todayForPlanning();
  const semaines = buildSemaines({ today, members, absences, affaires, weekCount: WEEK_COUNT, tauxJourFacture: taux, coutJourCharge: cout });
  const horizonResult = calcHorizon(semaines, activeCount);

  const avgDispo = semaines.length > 0
    ? semaines.reduce((s, w) => s + w.joursDisponibles, 0) / semaines.length : 5;
  const devisEnAttente = calcDevisEnAttente(affaires, cout, avgDispo);

  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthISO = toDateString(prevMonth).slice(0, 7);
  const caRealiseCents = invoices.reduce((sum, inv) => {
    if (!inv.issuedDate) return sum;
    if (String(inv.issuedDate).slice(0, 7) !== prevMonthISO) return sum;
    return sum + (inv.amountCents ?? 0);
  }, 0);

  const journees = calcJournees({
    prevMonthISO, caRealiseCents, activeCount,
    tauxJourFacture: taux, coutJourCharge: cout, parametresManquants,
  });

  res.json({
    etat: parametresManquants ? "PARAMETRES_MANQUANTS" : "OK",
    horizon: horizonResult.horizon,
    horizonPhrase: horizonResult.phrase,
    horizonSous: horizonResult.sous,
    activeCount, semaines, devisEnAttente, journees,
    tauxJourFacture: taux, coutJourCharge: cout,
  });
});

router.post("/equipe/plannings/simuler", async (req, res): Promise<void> => {
  const schema = z.object({
    joursNecessaires: z.number().int().min(1).max(1000),
    personnesNecessaires: z.number().int().min(1).max(500),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const tenantId = req.tenantId!;
  const { tauxJourFacture, coutJourCharge, rawMembers, absences, rawAffaires } =
    await fetchPlanningData(tenantId);

  const taux = tauxJourFacture ?? 0.7;
  const cout = coutJourCharge ?? 250;

  const members: MemberRecord[] = rawMembers.map(m => ({
    id: m.id, name: m.name, availability: m.availability,
    schedule: (() => { try { return JSON.parse(m.schedule); } catch { return []; } })(),
  }));
  const activeCount = members.filter(m => m.availability !== "ABSENT").length;

  const affaires: AffaireRecord[] = rawAffaires.map(a => ({
    id: a.id, label: a.label, status: a.status,
    quotedAmountCents: a.quotedAmountCents ?? null,
    startDate: a.startDate ?? null, completedAt: a.completedAt ?? null,
  }));

  const semaines = buildSemaines({
    today: todayForPlanning(), members, absences, affaires,
    weekCount: WEEK_COUNT, tauxJourFacture: taux, coutJourCharge: cout,
  });

  const result = simulerChantier({
    joursNecessaires: parsed.data.joursNecessaires,
    personnesNecessaires: parsed.data.personnesNecessaires,
    semaines, activeCount,
  });
  res.json(result);
});

router.patch("/equipe/plannings/taux", async (req, res): Promise<void> => {
  const schema = z.object({
    tauxJourFacture: z.number().min(0.1).max(1).optional(),
    coutJourCharge: z.number().min(1).optional(),
    tauxHoraire: z.number().optional(), // legacy — accepted, ignored
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const tenantId = req.tenantId!;

  const { tauxJourFacture, coutJourCharge } = await withTenant(tenantId, async (tx) => {
    if (parsed.data.tauxJourFacture !== undefined)
      await setSetting(tx, "equipe.tauxJourFacture", String(parsed.data.tauxJourFacture), tenantId);
    if (parsed.data.coutJourCharge !== undefined)
      await setSetting(tx, "equipe.coutJourCharge", String(parsed.data.coutJourCharge), tenantId);

    const tauxRaw = await getSetting(tx, "equipe.tauxJourFacture");
    const coutRaw = await getSetting(tx, "equipe.coutJourCharge");
    return {
      tauxJourFacture: tauxRaw !== null ? Number(tauxRaw) : null,
      coutJourCharge:  coutRaw !== null ? Number(coutRaw) : null,
    };
  });

  res.json({ ok: true, tauxJourFacture, coutJourCharge });
});

// ── Absences ──────────────────────────────────────────────────────────────

const AbsenceBody = z.object({
  membreId:  z.string().min(1),
  type:      z.enum(["Congés", "Maladie", "RTT", "Autre"]),
  dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateDebut must be YYYY-MM-DD"),
  dateFin:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateFin must be YYYY-MM-DD"),
}).refine(d => d.dateDebut <= d.dateFin, { message: "dateFin must be >= dateDebut", path: ["dateFin"] });

router.get("/equipe/absences", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const result = await withTenant(tenantId, async (tx) =>
    tx.execute(sql`
      SELECT id, membre_id AS "membreId", type,
             date_debut::text AS "dateDebut", date_fin::text AS "dateFin",
             created_at AS "createdAt"
      FROM absences WHERE tenant_id = ${tenantId}::uuid ORDER BY date_debut DESC LIMIT 50
    `)
  );
  res.json(result.rows);
});

router.post("/equipe/absences", async (req, res): Promise<void> => {
  const parsed = AbsenceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { membreId, type, dateDebut, dateFin } = parsed.data;
  const tenantId = req.tenantId!;

  const row = await withTenant(tenantId, async (tx) => {
    const [member] = await tx.select().from(teamMembersTable).where(eq(teamMembersTable.id, membreId));
    if (!member) return null;

    const result = await tx.execute(sql`
      INSERT INTO absences (id, tenant_id, membre_id, type, date_debut, date_fin)
      VALUES (gen_random_uuid()::text, ${tenantId}::uuid, ${membreId}, ${type}, ${dateDebut}::date, ${dateFin}::date)
      RETURNING id, membre_id AS "membreId", type,
                date_debut::text AS "dateDebut", date_fin::text AS "dateFin",
                created_at AS "createdAt"
    `);
    return result.rows[0];
  });

  if (!row) { res.status(400).json({ error: "membreId does not reference a known team member" }); return; }
  res.status(201).json(row);
});

export default router;
