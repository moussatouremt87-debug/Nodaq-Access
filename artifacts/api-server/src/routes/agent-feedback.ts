/**
 * Retour à chaud sur les productions de l'agent — ticket 4.36, lot C.
 *
 * ── Pourquoi au moment du jugement ────────────────────────────────────────
 * Le signal qualité se recueille quand l'utilisateur JUGE, pas trois semaines
 * plus tard dans un questionnaire. Un pouce sous un devis généré est daté,
 * rattaché à une production précise, et donné par quelqu'un qui vient de la
 * lire.
 *
 * ── Un clic, jamais un formulaire ─────────────────────────────────────────
 * `note` seule suffit. Le verbatim est facultatif et le restera : exiger une
 * explication, c'est transformer un geste d'une seconde en corvée, et ne plus
 * rien recueillir du tout.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { withTenant, agentFeedbackTable, NOTES_FEEDBACK } from "@workspace/db";

const router: IRouter = Router();

const CorpsFeedback = z.object({
  typeProduction: z.string().trim().min(1).max(60),
  referenceId: z.string().trim().max(120).optional(),
  note: z.enum(NOTES_FEEDBACK),
  // Court volontairement : c'est « qu'est-ce qui ne va pas ? », pas un rapport.
  verbatim: z.string().trim().max(1000).optional(),
});

router.post("/agent/feedback", async (req, res): Promise<void> => {
  const parsed = CorpsFeedback.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const d = parsed.data;

  await withTenant(tenantId, async (tx) => {
    // Un double-clic ne compte pas deux fois. L'index unique le refuserait de
    // toute façon ; on ne veut simplement pas rendre une erreur pour un geste
    // que l'utilisateur croit anodin.
    await tx
      .insert(agentFeedbackTable)
      .values({
        tenantId,
        typeProduction: d.typeProduction,
        note: d.note,
        ...(d.referenceId ? { referenceId: d.referenceId } : {}),
        ...(d.verbatim ? { verbatim: d.verbatim } : {}),
        ...(req.session?.userId ? { auteurUserId: req.session.userId } : {}),
      })
      .onConflictDoNothing();
  });

  // Aucun contenu renvoyé : l'écran n'a rien à afficher, et le geste ne doit
  // rien interrompre.
  res.status(204).end();
});

/**
 * La restitution : taux de satisfaction par type, et verbatims récents.
 *
 * ── Ce que la lecture NE fait pas ─────────────────────────────────────────
 * Elle ne compte jamais un silence comme un pouce en l'air. Le taux est
 * calculé sur les seules productions JUGÉES, et `total` le dit — sans quoi un
 * type de production peu utilisé afficherait 100 % sur deux avis.
 */
router.get("/agent/feedback/restitution", async (req, res): Promise<void> => {
  const jours = Math.min(Math.max(Number(req.query["jours"] ?? 30), 1), 365);
  const depuis = new Date(Date.now() - jours * 24 * 60 * 60 * 1000);
  const tenantId = req.tenantId!;

  const data = await withTenant(tenantId, async (tx) => {
    const parType = await tx
      .select({
        typeProduction: agentFeedbackTable.typeProduction,
        total: sql<number>`count(*)::int`,
        pouceHaut: sql<number>`count(*) FILTER (WHERE note = 'POUCE_HAUT')::int`,
      })
      .from(agentFeedbackTable)
      .where(gte(agentFeedbackTable.createdAt, depuis))
      .groupBy(agentFeedbackTable.typeProduction);

    // Les verbatims des pouces BAS seulement : un « très bien » n'apprend rien
    // à corriger, et c'est ce qui doit devenir un scénario d'éval.
    const verbatims = await tx
      .select({
        typeProduction: agentFeedbackTable.typeProduction,
        verbatim: agentFeedbackTable.verbatim,
        createdAt: agentFeedbackTable.createdAt,
      })
      .from(agentFeedbackTable)
      .where(
        and(
          eq(agentFeedbackTable.note, "POUCE_BAS"),
          gte(agentFeedbackTable.createdAt, depuis),
          sql`${agentFeedbackTable.verbatim} IS NOT NULL`,
        ),
      )
      .orderBy(desc(agentFeedbackTable.createdAt))
      .limit(20);

    return { parType, verbatims };
  });

  res.json({
    jours,
    parType: data.parType.map((t) => ({
      typeProduction: t.typeProduction,
      total: t.total,
      pouceHaut: t.pouceHaut,
      // Rendu en POINTS ENTIERS : afficher 66,67 % sur trois avis donnerait
      // une précision que la donnée n'a pas.
      tauxSatisfaction: t.total > 0 ? Math.round((t.pouceHaut / t.total) * 100) : null,
    })),
    verbatims: data.verbatims,
  });
});

export default router;
