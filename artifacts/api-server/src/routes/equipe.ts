import { Router, type IRouter } from "express";
import { db, pool, teamMembersTable, affairesTable, facturesTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { getDefaultTenantId } from "../lib/defaultTenant";
import { z } from "zod";
import {
  buildSemaines,
  calcHorizon,
  calcDevisEnAttente,
  calcJournees,
  simulerChantier,
  type MemberRecord,
  type AbsenceRecord,
  type AffaireRecord,
} from "../services/planning-service";

const router: IRouter = Router();

const SEED_MEMBERS = [
  { name: "Sophie Marchand", role: "Développeuse Full-Stack", email: "sophie@nodaq.fr", availability: "DISPONIBLE" },
  { name: "Thomas Dubois",   role: "Designer UX/UI",         email: "thomas@nodaq.fr", availability: "PARTIEL" },
  { name: "Amel Benali",     role: "Chef de projet",         email: "amel@nodaq.fr",   availability: "DISPONIBLE" },
] as const;

const DAYS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];

async function ensureDefaultMembers() {
  const existing = await db.select().from(teamMembersTable);
  if (existing.length === 0) {
    const tenantId = await getDefaultTenantId();
    for (const m of SEED_MEMBERS) {
      await db.insert(teamMembersTable).values({
        tenantId, name: m.name, role: m.role, email: m.email,
        availability: m.availability,
        schedule: JSON.stringify(DAYS.map(day => ({ day, affaireId: null }))),
      });
    }
  }
}

const CreateMemberBody = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  email: z.string().email().optional(),
  availability: z.enum(["DISPONIBLE", "PARTIEL", "ABSENT"]).optional(),
  schedule: z.array(z.object({ day: z.string(), affaireId: z.string().nullable() })).optional(),
});

const UpdateMemberBody = CreateMemberBody.partial();

router.get("/equipe", async (_req, res): Promise<void> => {
  await ensureDefaultMembers();
  const members = await db.select().from(teamMembersTable).orderBy(asc(teamMembersTable.createdAt));
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
  const tenantId = await getDefaultTenantId();
  const [member] = await db.insert(teamMembersTable).values({
    tenantId, name, role, availability,
    schedule: JSON.stringify(schedule),
    ...(email ? { email } : {}),
  }).returning();

  res.status(201).json({ ...member, schedule: JSON.parse(member!.schedule) });
});

router.patch("/equipe/:id", async (req, res): Promise<void> => {
  const { id } = req.params as { id: string };
  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
  if (parsed.data.email !== undefined) updateData.email = parsed.data.email;
  if (parsed.data.availability !== undefined) updateData.availability = parsed.data.availability;
  if (parsed.data.schedule !== undefined) updateData.schedule = JSON.stringify(parsed.data.schedule);

  const [updated] = await db.update(teamMembersTable)
    .set(updateData as any)
    .where(eq(teamMembersTable.id, id))
    .returning();

  res.json({ ...updated, schedule: JSON.parse(updated!.schedule) });
});

router.delete("/equipe/:id", async (req, res): Promise<void> => {
  const { id } = req.params as { id: string };
  const [existing] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(teamMembersTable).where(eq(teamMembersTable.id, id));
  res.status(204).send();
});

// ── Settings helpers ──────────────────────────────────────────────────────

async function getSetting(client: any, key: string): Promise<string | null> {
  const tenantId = await getDefaultTenantId();
  const { rows } = await client.query(
    "SELECT value FROM settings WHERE tenant_id = $1 AND key = $2",
    [tenantId, key],
  );
  return rows[0]?.value ?? null;
}

async function setSetting(client: any, key: string, value: string): Promise<void> {
  const tenantId = await getDefaultTenantId();
  await client.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
    [tenantId, key, value],
  );
}

// ── Planning ──────────────────────────────────────────────────────────────

const WEEK_COUNT = 10;

router.get("/equipe/plannings", async (_req, res): Promise<void> => {
  await ensureDefaultMembers();

  const client = await pool.connect();
  let tauxJourFacture: number | null = null;
  let coutJourCharge: number | null = null;

  try {
    const tauxRaw = await getSetting(client, "equipe.tauxJourFacture");
    const coutRaw = await getSetting(client, "equipe.coutJourCharge");
    if (tauxRaw !== null) tauxJourFacture = Number(tauxRaw);
    if (coutRaw !== null) coutJourCharge = Number(coutRaw);
  } finally {
    client.release();
  }

  const parametresManquants = tauxJourFacture === null || coutJourCharge === null;
  const taux = tauxJourFacture ?? 0.7;
  const cout = coutJourCharge ?? 250;

  // Fetch team members
  const rawMembers = await db.select().from(teamMembersTable).orderBy(asc(teamMembersTable.createdAt));
  const members: MemberRecord[] = rawMembers.map(m => ({
    id: m.id,
    name: m.name,
    availability: m.availability,
    schedule: (() => { try { return JSON.parse(m.schedule); } catch { return []; } })(),
  }));
  const activeCount = members.filter(m => m.availability !== "ABSENT").length;

  // Fetch absences
  const client2 = await pool.connect();
  let absences: AbsenceRecord[] = [];
  try {
    const tenantIdForAbsences = await getDefaultTenantId();
    const { rows } = await client2.query(
      `SELECT membre_id AS "membreId", date_debut::text AS "dateDebut", date_fin::text AS "dateFin"
       FROM absences WHERE tenant_id = $1 AND date_fin >= CURRENT_DATE`,
      [tenantIdForAbsences],
    );
    absences = rows as AbsenceRecord[];
  } catch {
    // absences table may not exist in some envs — gracefully degrade
  } finally {
    client2.release();
  }

  // Fetch affaires
  const rawAffaires = await db.select().from(affairesTable);
  const affaires: AffaireRecord[] = rawAffaires.map(a => ({
    id: a.id,
    label: a.label,
    status: a.status,
    quotedAmountCents: a.quotedAmountCents ?? null,
    startDate: a.startDate ?? null,
    completedAt: a.completedAt ?? null,
  }));

  // Build semaines
  const today = new Date();
  const semaines = buildSemaines({ today, members, absences, affaires, weekCount: WEEK_COUNT, tauxJourFacture: taux, coutJourCharge: cout });
  const horizonResult = calcHorizon(semaines, activeCount);

  // Devis en attente
  const avgDispo = semaines.length > 0
    ? semaines.reduce((s, w) => s + w.joursDisponibles, 0) / semaines.length
    : 5;
  const devisEnAttente = calcDevisEnAttente(affaires, cout, avgDispo);

  // Vos journées: previous month CA
  const now = new Date();
  const prevMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const prevMonthISO = prevMonth.toISOString().slice(0, 7);

  const invoices = await db.select().from(facturesTable);
  const caRealiseCents = invoices.reduce((sum, inv) => {
    if (!inv.issuedDate) return sum;
    if (String(inv.issuedDate).slice(0, 7) !== prevMonthISO) return sum;
    return sum + (inv.amountCents ?? 0);
  }, 0);

  const journees = calcJournees({
    prevMonthISO,
    caRealiseCents,
    activeCount,
    tauxJourFacture: taux,
    coutJourCharge: cout,
    parametresManquants,
  });

  res.json({
    etat: parametresManquants ? "PARAMETRES_MANQUANTS" : "OK",
    horizon: horizonResult.horizon,
    horizonPhrase: horizonResult.phrase,
    horizonSous: horizonResult.sous,
    activeCount,
    semaines,
    devisEnAttente,
    journees,
    tauxJourFacture: taux,
    coutJourCharge: cout,
  });
});

// POST: simulator — accepts { joursNecessaires, personnesNecessaires }, fetches live semaines
router.post("/equipe/plannings/simuler", async (req, res): Promise<void> => {
  const schema = z.object({
    joursNecessaires: z.number().int().min(1).max(1000),
    personnesNecessaires: z.number().int().min(1).max(500),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  // Fetch live planning data (same queries as GET /equipe/plannings)
  const client = await pool.connect();
  let tauxJourFacture = 0.7;
  let coutJourCharge = 250;
  try {
    const tauxRaw = await getSetting(client, "equipe.tauxJourFacture");
    const coutRaw = await getSetting(client, "equipe.coutJourCharge");
    if (tauxRaw !== null) tauxJourFacture = Number(tauxRaw);
    if (coutRaw !== null) coutJourCharge = Number(coutRaw);
  } finally {
    client.release();
  }

  const rawMembers = await db.select().from(teamMembersTable).orderBy(asc(teamMembersTable.createdAt));
  const members: MemberRecord[] = rawMembers.map(m => ({
    id: m.id, name: m.name, availability: m.availability,
    schedule: (() => { try { return JSON.parse(m.schedule); } catch { return []; } })(),
  }));
  const activeCount = members.filter(m => m.availability !== "ABSENT").length;

  const client2 = await pool.connect();
  let absences: AbsenceRecord[] = [];
  try {
    const tenantIdForAbsences = await getDefaultTenantId();
    const { rows } = await client2.query(
      `SELECT membre_id AS "membreId", date_debut::text AS "dateDebut", date_fin::text AS "dateFin"
       FROM absences WHERE tenant_id = $1 AND date_fin >= CURRENT_DATE`,
      [tenantIdForAbsences],
    );
    absences = rows as AbsenceRecord[];
  } catch { /* absences table may not exist */ } finally { client2.release(); }

  const rawAffaires = await db.select().from(affairesTable);
  const affaires: AffaireRecord[] = rawAffaires.map(a => ({
    id: a.id, label: a.label, status: a.status,
    quotedAmountCents: a.quotedAmountCents ?? null,
    startDate: a.startDate ?? null,
    completedAt: a.completedAt ?? null,
  }));

  const semaines = buildSemaines({ today: new Date(), members, absences, affaires, weekCount: WEEK_COUNT, tauxJourFacture, coutJourCharge });
  const result = simulerChantier({ joursNecessaires: parsed.data.joursNecessaires, personnesNecessaires: parsed.data.personnesNecessaires, semaines, activeCount });
  res.json(result);
});

// PATCH: update settings keys (tauxHoraire is legacy — stored as no-op but accepted without error)
router.patch("/equipe/plannings/taux", async (req, res): Promise<void> => {
  const schema = z.object({
    tauxJourFacture: z.number().min(0.1).max(1).optional(),
    coutJourCharge: z.number().min(1).optional(),
    // legacy key — accepted without error; callers should migrate to tauxJourFacture
    tauxHoraire: z.number().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const client = await pool.connect();
  try {
    if (parsed.data.tauxJourFacture !== undefined)
      await setSetting(client, "equipe.tauxJourFacture", String(parsed.data.tauxJourFacture));
    if (parsed.data.coutJourCharge !== undefined)
      await setSetting(client, "equipe.coutJourCharge", String(parsed.data.coutJourCharge));
  } finally {
    client.release();
  }

  // Return updated settings so callers don't need a separate GET
  const client3 = await pool.connect();
  let tauxJourFacture: number | null = null;
  let coutJourCharge: number | null = null;
  try {
    const t = await getSetting(client3, "equipe.tauxJourFacture");
    const c = await getSetting(client3, "equipe.coutJourCharge");
    if (t !== null) tauxJourFacture = Number(t);
    if (c !== null) coutJourCharge = Number(c);
  } finally {
    client3.release();
  }

  res.json({ ok: true, tauxJourFacture, coutJourCharge });
});

// ── Absences ──────────────────────────────────────────────────────────────

const AbsenceBody = z.object({
  membreId:  z.string().min(1),
  type:      z.enum(["Congés", "Maladie", "RTT", "Autre"]),
  dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateDebut must be YYYY-MM-DD"),
  dateFin:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateFin must be YYYY-MM-DD"),
}).refine(d => d.dateDebut <= d.dateFin, { message: "dateFin must be >= dateDebut", path: ["dateFin"] });

router.get("/equipe/absences", async (_req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const tenantId = await getDefaultTenantId();
    const { rows } = await client.query(
      `SELECT id, membre_id AS "membreId", type,
              date_debut::text AS "dateDebut", date_fin::text AS "dateFin",
              created_at AS "createdAt"
       FROM absences WHERE tenant_id = $1 ORDER BY date_debut DESC LIMIT 50`,
      [tenantId],
    );
    res.json(rows);
  } finally {
    client.release();
  }
});

router.post("/equipe/absences", async (req, res): Promise<void> => {
  const parsed = AbsenceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { membreId, type, dateDebut, dateFin } = parsed.data;
  const [member] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.id, membreId));
  if (!member) { res.status(400).json({ error: "membreId does not reference a known team member" }); return; }

  const client = await pool.connect();
  try {
    const tenantId = await getDefaultTenantId();
    const { rows } = await client.query(
      `INSERT INTO absences (id, tenant_id, membre_id, type, date_debut, date_fin)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
       RETURNING id, membre_id AS "membreId", type,
                 date_debut::text AS "dateDebut", date_fin::text AS "dateFin",
                 created_at AS "createdAt"`,
      [tenantId, membreId, type, dateDebut, dateFin],
    );
    res.status(201).json(rows[0]);
  } finally {
    client.release();
  }
});

export default router;
