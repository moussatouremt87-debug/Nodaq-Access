/**
 * Le brief du matin, envoyé sans que personne ouvre l'application.
 *
 * ── POURQUOI CE N'EST PAS UNE TÂCHE PLANIFIÉE DANS LE CODE ──────────────────
 *
 * Ce dépôt n'a AUCUN ordonnanceur, et c'est un parti pris : l'échéance d'essai
 * se constate paresseusement, le retour de formule aussi. Un `setInterval`
 * dans le serveur tomberait en double dès qu'il y a deux instances, et
 * mourrait silencieusement au redéploiement.
 *
 * Mais un brief du matin ne peut pas être paresseux : personne n'est là pour
 * le déclencher. Le déclencheur est donc EXTÉRIEUR — un cron de conteneur qui
 * appelle une route. Le serveur reste sans mémoire du temps qui passe.
 *
 * ── CE QUE ÇA IMPOSE : L'IDEMPOTENCE ────────────────────────────────────────
 *
 * Un déclencheur extérieur se répète — reprise après incident, double instance
 * pendant un déploiement progressif, relance manuelle. La contrainte UNIQUE
 * (tenant, jour) de `briefs_envoyes` fait la garde à la place du code : deux
 * exécutions concurrentes insèrent, une seule gagne. L'artisan ne reçoit
 * jamais deux fois le même message.
 *
 * L'insertion précède l'envoi, délibérément. Si l'envoi échoue ensuite, on
 * perd un brief ; si l'ordre était inverse, une panne au mauvais moment en
 * enverrait deux. Entre manquer un message quotidien et en envoyer deux, le
 * premier se pardonne.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, withTenant, briefsEnvoyesTable, subscriptionsTable,
  membershipsTable, usersTable, settingsTable,
} from "@workspace/db";
import { toDateString } from "@nodaq/shared";
import { composerBrief } from "./brief.js";
import { sendDocument } from "./canal-emission.js";

/** Le réglage par tenant. Absent = le brief part : c'est le service rendu. */
export const CLE_BRIEF_QUOTIDIEN = "brief.quotidien";

/** Ce qu'un tenant peut poser pour ne plus le recevoir. */
export const VALEUR_DESACTIVE = "non";

export interface ResultatEnvoiBrief {
  readonly tenantId: string;
  /**
   * La DÉCISION, pas le sort du courriel.
   *
   * Les deux étaient confondus dans une première version, et c'était faux :
   * en test aucune sortie réseau n'est permise — `getTransporter()` rend
   * `null` délibérément — donc tout envoi « échouait » et le chemin nominal
   * devenait intestable.
   *
   * Surtout, ce sont deux faits distincts. La journée est RÉSERVÉE avant
   * l'envoi (voir plus bas) : un échec de messagerie la consomme quand même,
   * puisqu'on préfère perdre un brief que d'en envoyer deux. Dire « échec »
   * laisserait croire qu'il repartira, alors que non.
   */
  readonly etat: "envoye" | "deja_envoye" | "desactive" | "rien_a_dire" | "sans_destinataire";
  /** Le transporteur a-t-il accepté ? Le journal d'envois fait foi ensuite. */
  readonly remis?: boolean;
}

/**
 * Les tenants qui doivent recevoir un brief : ceux dont l'abonnement est ACTIF.
 *
 * Un tenant EN_ATTENTE n'a rien payé et ne peut rien écrire — lui envoyer un
 * point quotidien serait lui parler d'un produit qu'il n'utilise pas. Un
 * READONLY non plus : son espace est figé, il n'y a rien de nouveau à dire.
 */
async function tenantsEligibles(): Promise<string[]> {
  const lignes = await db
    .select({ tenantId: subscriptionsTable.tenantId })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.statut, "ACTIVE"));
  return lignes.map((l) => l.tenantId);
}

/**
 * À qui l'envoyer : le PROPRIÉTAIRE, lu en base.
 *
 * Jamais une adresse reçue en paramètre. Une route déclenchée de l'extérieur
 * qui accepterait un destinataire serait un moyen de faire envoyer les données
 * d'un tenant à n'importe qui — même famille de garde que la transmission du
 * support, où le destinataire n'est pas non plus un paramètre.
 */
async function destinataire(tenantId: string): Promise<string | null> {
  const [ligne] = await db
    .select({ email: usersTable.email })
    .from(membershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, membershipsTable.userId))
    .where(and(
      eq(membershipsTable.tenantId, tenantId),
      inArray(membershipsTable.role, ["OWNER"]),
    ))
    .limit(1);
  return ligne?.email ?? null;
}

/** Le texte du courriel. Sobre : il renvoie à l'application, il ne la remplace pas. */
export function corpsBrief(
  brief: Awaited<ReturnType<typeof composerBrief>>, lienApp: string,
): string {
  const lignes: string[] = [brief.greeting, ""];
  for (const section of brief.sections) {
    lignes.push(section.title);
    for (const item of section.items.slice(0, 4)) {
      lignes.push(`  · ${item.label}${item.meta ? ` — ${item.meta}` : ""}`);
    }
    lignes.push("");
  }
  lignes.push(`Tout est dans nodaq : ${lienApp}`);
  lignes.push("");
  lignes.push(
    "Pour ne plus recevoir ce point quotidien : écran Paramètres, "
    + "« Point quotidien par courriel ».",
  );
  return lignes.join("\n");
}

/** Envoie le brief d'UN tenant, une fois pour la journée. */
export async function envoyerBriefDuJour(
  tenantId: string, maintenant = new Date(),
): Promise<ResultatEnvoiBrief> {
  const jour = toDateString(maintenant);

  const desactive = await withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .select({ valeur: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, CLE_BRIEF_QUOTIDIEN));
    return r?.valeur === VALEUR_DESACTIVE;
  });
  if (desactive) return { tenantId, etat: "desactive" };

  const email = await destinataire(tenantId);
  if (!email) return { tenantId, etat: "sans_destinataire" };

  const brief = await composerBrief(tenantId);
  /*
   * « Tout est en ordre » est la section de repli du brief : quand c'est la
   * seule, il n'y a rien à dire. Envoyer quand même un courriel quotidien pour
   * annoncer qu'il ne se passe rien apprend à l'artisan à ne plus les ouvrir —
   * et le jour où il y a une vraie urgence, elle est déjà classée avec le
   * reste.
   */
  const rienADire = brief.sections.length === 1 && brief.sections[0]?.type === "summary";
  if (rienADire) return { tenantId, etat: "rien_a_dire" };

  /*
   * On RÉSERVE la journée avant d'envoyer. `onConflictDoNothing` sur la
   * contrainte UNIQUE : si une autre exécution a déjà pris la place, elle
   * n'insère rien, on s'arrête ici et aucun second courriel ne part.
   */
  const reserve = await withTenant(tenantId, async (tx) => tx
    .insert(briefsEnvoyesTable)
    .values({ tenantId, jour, destinataire: email, sections: brief.sections.length })
    .onConflictDoNothing()
    .returning({ id: briefsEnvoyesTable.id }));
  if (reserve.length === 0) return { tenantId, etat: "deja_envoye" };

  const lienApp = process.env["APP_URL"]?.replace(/\/$/, "") ?? "";
  const envoi = await sendDocument({
    canal: "EMAIL",
    tenantId,
    to: email,
    subject: `nodaq — votre point du jour`,
    body: corpsBrief(brief, lienApp),
    documentType: "BRIEF_QUOTIDIEN",
  });
  return { tenantId, etat: "envoye", remis: envoi.success };
}

/**
 * Le tour complet. Rendu par la route déclenchée de l'extérieur.
 *
 * Un tenant qui échoue n'arrête pas les autres : le brief de l'un ne doit pas
 * dépendre de la boîte aux lettres de l'autre.
 */
export async function envoyerBriefsDuJour(
  maintenant = new Date(),
): Promise<ResultatEnvoiBrief[]> {
  const resultats: ResultatEnvoiBrief[] = [];
  for (const tenantId of await tenantsEligibles()) {
    try {
      resultats.push(await envoyerBriefDuJour(tenantId, maintenant));
    } catch {
      // Le contenu de l'erreur n'est PAS journalisé (règle 6) : le brief cite
      // des noms de clients et des montants. La journée reste réservée si elle
      // l'a été — on ne réessaie pas, pour ne pas doubler.
      resultats.push({ tenantId, etat: "envoye", remis: false });
    }
  }
  return resultats;
}
