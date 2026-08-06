import { Router, type IRouter } from "express";
import { db, pool, teamMembersTable, contratsTable, facturesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";

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
    for (const m of SEED_MEMBERS) {
      await db.insert(teamMembersTable).values({
        name: m.name, role: m.role, email: m.email,
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
  const [member] = await db.insert(teamMembersTable).values({
    name,
    role,
    availability,
    schedule: JSON.stringify(schedule),
    ...(email ? { email } : {}),
  }).returning();

  res.status(201).json({ ...member, schedule: JSON.parse(member!.schedule) });
});

router.patch("/equipe/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
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
  const { id } = req.params;
  const [existing] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(teamMembersTable).where(eq(teamMembersTable.id, id));
  res.status(204).send();
});

// ── Planning data ─────────────────────────────────────────────────────────
/** Return YYYY-MM for a month offset from today (0 = current month) */
function monthLabel(offsetMonths: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().slice(0, 7);
}

/**
 * Monthly revenue in cents for a contract, derived from its cadence.
 * amountCents is stored as integer-equivalent cents in the DB.
 */
function monthlyRevenueCents(amountCents: number | null, cadence: string): number {
  const c = amountCents ?? 0;
  switch (cadence) {
    case "mensuel":     return c;
    case "trimestriel": return c / 3;
    case "semestriel":  return c / 6;
    case "annuel":      return c / 12;
    default:            return c;
  }
}

/** Build capacity + performance rows from live DB data */
async function buildPlanningData(tauxHoraire: number) {
  const CAPACITY_H_PER_MEMBER = 151; // 35 h/week × 4.33 weeks/month, fixed integer
  const PAST_MONTHS = 6;
  const FUTURE_MONTHS = 6;

  // ── Active team members → capacity ──────────────────────────────────────
  // Ensure seed members exist before reading — planning can be fetched before
  // GET /equipe, which is the only other path that seeds default members.
  await ensureDefaultMembers();
  const members = await db.select().from(teamMembersTable);
  const activeCount = members.filter(m => m.availability !== "ABSENT").length;
  const capaciteH = activeCount * CAPACITY_H_PER_MEMBER; // 0 when no active members

  // ── Active contracts → monthly charge estimate ───────────────────────────
  // Work in cents throughout; derive hours via (cents) / (tauxHoraire * 100)
  // so a contract worth 38 000 c (380 €) at 60 €/h → 380/60 ≈ 6.33 h
  const contracts = await db.select().from(contratsTable)
    .where(eq(contratsTable.status, "ACTIF"));
  const totalMonthlyContractCents = contracts.reduce(
    (sum, c) => sum + monthlyRevenueCents(c.amountCents, c.cadence),
    0,
  );
  // tauxHoraire is in €/h; multiply by 100 to stay in cent units
  const contractChargeH = tauxHoraire > 0
    ? totalMonthlyContractCents / (tauxHoraire * 100)
    : 0;

  // ── Future months: capacity vs contract-derived charge ───────────────────
  const capacity = Array.from({ length: FUTURE_MONTHS }, (_, i) => {
    const chargeH = Math.round(contractChargeH);
    const ecartH = capaciteH - chargeH;
    let verdict: string;
    if (capaciteH === 0 && chargeH === 0) verdict = "inconnu";
    else if (ecartH < 0) verdict = "sous-capacité";
    else if (chargeH === 0) verdict = "inconnu";
    else if (ecartH < capaciteH * 0.1) verdict = "limite";
    else verdict = "ok";
    return { mois: monthLabel(i), capaciteH, chargeH, ecartH, verdict };
  });

  // ── Invoices → CA réalisé per past month ────────────────────────────────
  // Accumulate in cents, then convert to euros for the response
  const invoices = await db.select().from(facturesTable);
  const caByMonthCents: Record<string, number> = {};
  for (const inv of invoices) {
    if (!inv.issuedDate) continue;
    const mois = String(inv.issuedDate).slice(0, 7);
    caByMonthCents[mois] = (caByMonthCents[mois] ?? 0) + (inv.amountCents ?? 0);
  }

  // ── Past months: heuresEstimees (from contracts) + CA réalisé (from invoices) ──
  const performance = Array.from({ length: PAST_MONTHS }, (_, i) => {
    const mois = monthLabel(-(PAST_MONTHS - i));
    // caRealise in euros (÷ 100) for display
    const caRealise = Math.round((caByMonthCents[mois] ?? 0) / 100);
    // heuresEstimees mirrors contractChargeH — same contracts, same rate
    const heuresEstimees = Math.round(contractChargeH);
    const eurosParHeure = heuresEstimees > 0
      ? Math.round(caRealise / heuresEstimees)
      : null;
    const verdict = eurosParHeure === null
      ? "inconnu"
      : eurosParHeure >= tauxHoraire
        ? "ok"
        : "sous-objectif";
    return { mois, caRealise, heuresEstimees, eurosParHeure, verdict };
  });

  return { capacity, performance, tauxHoraire };
}

router.get("/equipe/plannings", async (_req, res): Promise<void> => {
  const client = await pool.connect();
  let tauxHoraire = 60;
  try {
    const { rows } = await client.query(
      "SELECT value FROM settings WHERE key = 'equipe.tauxHoraire'",
    );
    if (rows[0]) tauxHoraire = Number(rows[0].value);
  } finally {
    client.release();
  }
  const data = await buildPlanningData(tauxHoraire);
  res.json(data);
});

router.patch("/equipe/plannings/taux", async (req, res): Promise<void> => {
  const { tauxHoraire } = req.body ?? {};
  const val = Number(tauxHoraire);
  if (!Number.isFinite(val) || val <= 0) {
    res.status(400).json({ error: "tauxHoraire must be a positive number" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO settings (key, value) VALUES ('equipe.tauxHoraire', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [String(val)],
    );
  } finally {
    client.release();
  }
  // Return updated planning rows so the client can update in one round-trip
  const data = await buildPlanningData(val);
  res.json(data);
});

// ── Absences ──────────────────────────────────────────────────────────────
const AbsenceBody = z.object({
  membreId:  z.string().min(1),
  type:      z.enum(["Congés", "Maladie", "RTT", "Autre"]),
  dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateDebut must be YYYY-MM-DD"),
  dateFin:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateFin must be YYYY-MM-DD"),
}).refine(d => d.dateDebut <= d.dateFin, {
  message: "dateFin must be >= dateDebut",
  path: ["dateFin"],
});

router.get("/equipe/absences", async (_req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT id, membre_id AS \"membreId\", type, date_debut::text AS \"dateDebut\", date_fin::text AS \"dateFin\", created_at AS \"createdAt\" FROM absences ORDER BY date_debut DESC LIMIT 50",
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

  // Verify the referenced team member exists
  const [member] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.id, membreId));
  if (!member) { res.status(400).json({ error: "membreId does not reference a known team member" }); return; }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO absences (id, membre_id, type, date_debut, date_fin)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
       RETURNING id, membre_id AS "membreId", type, date_debut::text AS "dateDebut", date_fin::text AS "dateFin", created_at AS "createdAt"`,
      [membreId, type, dateDebut, dateFin],
    );
    res.status(201).json(rows[0]);
  } finally {
    client.release();
  }
});

export default router;
