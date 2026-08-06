import { Router, type IRouter } from "express";
import { db, teamMembersTable } from "@workspace/db";
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

export default router;
