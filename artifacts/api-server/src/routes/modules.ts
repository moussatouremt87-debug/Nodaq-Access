/**
 * Modules — lecture pour tous, écriture pour le propriétaire.
 *
 * Deux routeurs, comme `onboarding.ts` : la LECTURE est montée sous `biz`
 * parce que la navigation en dépend et que tout le monde navigue — un MEMBER
 * qui ne pourrait pas lire l'état des modules verrait un menu différent de
 * celui de son patron, sans que rien ne l'explique. L'ÉCRITURE est réservée
 * au propriétaire : allumer un module engage le compte.
 *
 * ── Ce n'est PAS une frontière de sécurité ──────────────────────────────
 * Éteindre un module retire sa page de la navigation et ses outils de
 * l'agent. Les routes HTTP correspondantes restent ouvertes, avec leurs
 * contrôles d'accès inchangés — c'est de la surface produit, pas de
 * l'autorisation, et le catalogue le dit explicitement. Quiconque connaît
 * l'URL atteint toujours l'écran : c'est voulu, et c'est pourquoi aucun
 * réglage de module ne doit jamais servir à cacher une donnée sensible.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant, settingsTable } from "@workspace/db";
import { MODULES } from "@nodaq/shared";
import { modulesDuTenant, PREFIXE_MODULE } from "../lib/modules-tenant.js";
import { messageValidation } from "../lib/message-validation.js";

export const modulesReadRouter: IRouter = Router();
export const modulesWriteRouter: IRouter = Router();

modulesReadRouter.get("/modules", async (req, res): Promise<void> => {
  res.json({ modules: await modulesDuTenant(req.tenantId!) });
});

const CorpsChoix = z.object({
  /** `id du module → actif`. Un identifiant inconnu est refusé, pas ignoré. */
  choix: z.record(z.string(), z.boolean()),
});

modulesWriteRouter.patch("/modules", async (req, res): Promise<void> => {
  const parsed = CorpsChoix.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: messageValidation(parsed.error) });
    return;
  }

  const connus = new Set(MODULES.map((m) => m.id));
  const inconnus = Object.keys(parsed.data.choix).filter((id) => !connus.has(id));
  if (inconnus.length > 0) {
    // Refusé plutôt qu'ignoré : un identifiant inconnu vient d'une faute de
    // frappe ou d'un module supprimé, et l'accepter en silence écrirait un
    // réglage que plus rien ne lira jamais.
    res.status(400).json({
      error: `Module inconnu : ${inconnus.join(", ")}. Modules disponibles : ${[...connus].join(", ")}.`,
    });
    return;
  }

  const tenantId = req.tenantId!;
  await withTenant(tenantId, async (tx) => {
    for (const [id, actif] of Object.entries(parsed.data.choix)) {
      const key = PREFIXE_MODULE + id;
      const value = String(actif);
      await tx
        .insert(settingsTable)
        .values({ tenantId, key, value })
        .onConflictDoUpdate({
          target: [settingsTable.tenantId, settingsTable.key],
          set: { value, updatedAt: sql`now()` },
        });
    }
  });

  res.json({ modules: await modulesDuTenant(tenantId) });
});

export default modulesReadRouter;
