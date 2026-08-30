/**
 * Règle de négociation de la relance — ticket 4.18, US-9.
 *
 * Deux routeurs, comme `onboarding.ts` et `modules.ts`.
 *
 * La LECTURE est montée sous `biz`. L'US-9 le justifie : « un MEMBER valide des
 * campagnes DANS LE CADRE de la règle, il ne modifie pas la règle ». Pour
 * valider dans un cadre, encore faut-il le voir — un MEMBER qui approuverait
 * une campagne sans savoir ce que l'agent a le droit d'accorder n'approuverait
 * rien de compréhensible.
 *
 * L'ÉCRITURE est réservée au propriétaire, et elle n'écrase jamais : chaque
 * modification INSÈRE une version. C'est ce qui permet à un mandat de campagne
 * de figer le numéro qui s'appliquait, et donc de tenir la promesse de l'US-9 —
 * « un changement de règle ne modifie jamais rétroactivement une campagne déjà
 * validée ».
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { withTenant, reglesRelanceTable } from "@workspace/db";
import {
  REGLE_RELANCE_DEFAUT,
  verifierRegleRelance,
  resumerRegleRelance,
  type RegleRelance,
} from "@nodaq/shared";
import { messageValidation } from "../lib/message-validation.js";

export const reglesRelanceReadRouter: IRouter = Router();
export const reglesRelanceWriteRouter: IRouter = Router();

interface RegleCourante extends RegleRelance {
  /** 0 = aucune version posée : c'est le défaut prudent qui s'applique. */
  readonly version: number;
  readonly poseeParEmail: string | null;
  readonly poseeLe: string | null;
  readonly resume: string;
}

/**
 * La règle en vigueur : la version la plus haute, ou le défaut prudent.
 *
 * Le défaut n'est PAS écrit en base à la création du tenant. Une ligne posée
 * d'office porterait un auteur qui n'a rien décidé, et ferait croire à un choix
 * là où il n'y a qu'une absence — alors que `version: 0` dit exactement ce qui
 * est vrai : personne n'a encore tranché, donc rien n'est concédé.
 */
async function regleCourante(tenantId: string): Promise<RegleCourante> {
  const [ligne] = await withTenant(tenantId, async (tx) =>
    tx
      .select()
      .from(reglesRelanceTable)
      .where(eq(reglesRelanceTable.tenantId, tenantId))
      .orderBy(desc(reglesRelanceTable.version))
      .limit(1),
  );

  if (!ligne) {
    return {
      ...REGLE_RELANCE_DEFAUT,
      version: 0,
      poseeParEmail: null,
      poseeLe: null,
      resume: resumerRegleRelance(REGLE_RELANCE_DEFAUT),
    };
  }

  const regle: RegleRelance = {
    echelonnementAutorise: ligne.echelonnementAutorise,
    maxVersements: ligne.maxVersements,
    delaiMaxPremierVersementJours: ligne.delaiMaxPremierVersementJours,
    retardMaxJours: ligne.retardMaxJours,
    lienPaiementAutorise: ligne.lienPaiementAutorise,
    remiseAutorisee: ligne.remiseAutorisee,
  };

  return {
    ...regle,
    version: ligne.version,
    poseeParEmail: ligne.poseeParEmail,
    poseeLe: ligne.createdAt.toISOString(),
    resume: resumerRegleRelance(regle),
  };
}

reglesRelanceReadRouter.get("/relance/regles", async (req, res): Promise<void> => {
  res.json(await regleCourante(req.tenantId!));
});

const CorpsRegle = z.object({
  echelonnementAutorise: z.boolean(),
  maxVersements: z.number().int(),
  delaiMaxPremierVersementJours: z.number().int(),
  retardMaxJours: z.number().int(),
  lienPaiementAutorise: z.boolean(),
  remiseAutorisee: z.boolean(),
});

reglesRelanceWriteRouter.put("/relance/regles", async (req, res): Promise<void> => {
  const parsed = CorpsRegle.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: messageValidation(parsed.error) });
    return;
  }

  // Vérifié AVANT d'écrire, pour rendre une erreur lisible : les CHECK SQL
  // refuseraient aussi, mais avec un message de contrainte incompréhensible
  // pour le dirigeant qui règle son écran.
  const anomalies = verifierRegleRelance(parsed.data);
  if (anomalies.length > 0) {
    res.status(422).json({ error: anomalies[0]!.message, anomalies });
    return;
  }

  const tenantId = req.tenantId!;
  const email = req.session?.email ?? null;
  const userId = req.session?.userId ?? null;

  await withTenant(tenantId, async (tx) => {
    // La version suivante est calculée DANS la transaction, et la contrainte
    // UNIQUE (tenant_id, version) tranche si deux propriétaires enregistrent en
    // même temps : le second échoue plutôt que d'écraser silencieusement le
    // premier ou de créer deux « version 4 » incomparables.
    const [max] = await tx
      .select({ v: sql<number>`coalesce(max(${reglesRelanceTable.version}), 0)::int` })
      .from(reglesRelanceTable)
      .where(eq(reglesRelanceTable.tenantId, tenantId));

    await tx.insert(reglesRelanceTable).values({
      tenantId,
      version: (max?.v ?? 0) + 1,
      ...parsed.data,
      poseePar: userId,
      poseeParEmail: email,
    });
  });

  res.json(await regleCourante(tenantId));
});

export default reglesRelanceReadRouter;
