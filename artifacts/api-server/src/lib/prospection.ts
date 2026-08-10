/**
 * Prospection — la couche qui décide, côté SERVEUR.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Ce n'est pas l'interface qui décide ce qu'on a le droit d'envoyer.       ║
 * ║  Toute route d'envoi passe par `verifierEnvoi`, qui refuse.               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  withTenant,
  contactsProspectionTable,
  contactBasesTable,
  oppositionsTable,
  settingsTable,
  type ContactProspection,
} from "@workspace/db";
import {
  canauxAutorises,
  type BaseLegale,
  type Canal,
  type CanauxAutorises,
  type TypeContact,
} from "@nodaq/shared";

const CLE_SEL = "prospection.sel_empreinte";

/**
 * Le sel d'empreinte du tenant, engendré à la première demande.
 *
 * SALÉ PAR TENANT, et c'est le point : sans sel, un tenant pourrait calculer
 * le condensat d'une adresse et vérifier si elle figure dans les oppositions
 * d'un autre. Le sel rend les empreintes incomparables d'un tenant à l'autre.
 *
 * Rangé dans `settings` et non dans `tenant_secrets` : ce n'est pas un secret
 * qui ouvre un accès chez un tiers, et il doit rester lisible en clair par la
 * requête qui compare les empreintes.
 */
async function selDuTenant(tenantId: string): Promise<string> {
  const existant = await withTenant(tenantId, (tx) =>
    tx
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, CLE_SEL)),
  );
  const v = existant[0]?.value;
  if (typeof v === "string" && v.length > 0) return v;

  const sel = randomBytes(32).toString("hex");
  await withTenant(tenantId, (tx) =>
    tx
      .insert(settingsTable)
      .values({ tenantId, key: CLE_SEL, value: sel })
      .onConflictDoNothing(),
  );
  // Relecture : deux requêtes simultanées peuvent avoir engendré deux sels,
  // une seule est écrite, et c'est celle-là qui fait foi.
  const relu = await withTenant(tenantId, (tx) =>
    tx
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, CLE_SEL)),
  );
  return relu[0]?.value ?? sel;
}

/**
 * Normalise une coordonnée avant de l'empreindre.
 *
 * Sans normalisation, « Jean.Dupont@Example.FR » et « jean.dupont@example.fr »
 * donneraient deux empreintes, et l'opposition ne tiendrait pas au premier
 * réimport — précisément ce qu'on veut éviter. Idem pour un téléphone écrit
 * avec des espaces ou des points.
 */
export function normaliserCoordonnee(nature: "email" | "telephone", brut: string): string {
  const t = brut.trim().toLowerCase();
  return nature === "email" ? t : t.replace(/[^0-9+]/g, "");
}

export async function empreinte(
  tenantId: string,
  nature: "email" | "telephone",
  brut: string,
): Promise<string> {
  const sel = await selDuTenant(tenantId);
  return createHash("sha256")
    .update(`${sel}|${nature}|${normaliserCoordonnee(nature, brut)}`)
    .digest("hex");
}

/** La personne s'est-elle opposée, sur l'une ou l'autre de ses coordonnées ? */
export async function estOppose(tenantId: string, contact: ContactProspection): Promise<boolean> {
  const empreintes: string[] = [];
  if (contact.email) empreintes.push(await empreinte(tenantId, "email", contact.email));
  if (contact.telephone) empreintes.push(await empreinte(tenantId, "telephone", contact.telephone));
  if (empreintes.length === 0) return false;

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: oppositionsTable.id })
      .from(oppositionsTable)
      // `inArray` et non `sql\`= ANY(${...})\`` : Drizzle déplie un tableau JS
      // en TUPLE `($1, $2)`, ce que `ANY` refuse. La requête échouait en 500.
      .where(inArray(oppositionsTable.empreinte, empreintes)),
  );
  return rows.length > 0;
}

/** La base légale COURANTE d'un contact : la dernière posée. */
export async function baseCourante(
  tenantId: string,
  contactId: string,
): Promise<{ base: BaseLegale; informeeLe: string | null; source: string } | null> {
  const [ligne] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(contactBasesTable)
      .where(eq(contactBasesTable.contactId, contactId))
      .orderBy(desc(contactBasesTable.createdAt))
      .limit(1),
  );
  if (!ligne) return null;
  return {
    base: ligne.base as BaseLegale,
    informeeLe: ligne.informeeLe,
    source: ligne.source,
  };
}

export type Verdict =
  | { readonly ok: true; readonly canaux: CanauxAutorises }
  | { readonly ok: false; readonly motif: string; readonly canaux: CanauxAutorises };

/**
 * LA décision. Toute route d'envoi passe par ici.
 *
 * Un contact sans base légale n'est pas prospectable — il est lisible, mais
 * aucun canal ne lui est ouvert. C'est le défaut, pas une exception.
 */
export async function verifierEnvoi(
  tenantId: string,
  contact: ContactProspection,
  canal: Canal,
): Promise<Verdict> {
  const aucun: CanauxAutorises = { email: false, telephone: false, courrier: false };

  const base = await baseCourante(tenantId, contact.id);
  if (!base) {
    return {
      ok: false,
      canaux: aucun,
      motif:
        "Aucune base légale enregistrée pour ce contact. Il est consultable, " +
        "mais aucun canal ne lui est ouvert tant qu'une base n'a pas été posée.",
    };
  }

  const oppose = await estOppose(tenantId, contact);
  const canaux = canauxAutorises(
    contact.type as TypeContact,
    base.base,
    base.informeeLe,
    oppose,
  );

  if (canaux[canal]) return { ok: true, canaux };

  if (oppose) {
    return { ok: false, canaux, motif: "Cette personne s'est opposée à la prospection." };
  }
  if (base.base === "INTERET_LEGITIME_PARTICULIER" && !base.informeeLe) {
    return {
      ok: false,
      canaux,
      motif:
        "Ce particulier n'a pas encore été informé (article 14). Aucun canal " +
        "n'est ouvert avant l'envoi de l'information.",
    };
  }
  if (contact.type === "PARTICULIER" && base.base === "INTERET_LEGITIME_PARTICULIER") {
    return {
      ok: false,
      canaux,
      motif:
        "Un particulier repéré dans une source publique ne peut être ni appelé " +
        "ni contacté par e-mail, même informé. Seul le courrier est ouvert.",
    };
  }
  return {
    ok: false,
    canaux,
    motif: `Le canal « ${canal} » n'est pas ouvert pour ce contact.`,
  };
}

// ── Embargo ──────────────────────────────────────────────────────────────────

/** Ce qu'une route a le droit de RENVOYER pour un contact. */
export interface ContactExpose {
  readonly id: string;
  readonly nom: string;
  readonly type: string;
  readonly ville: string | null;
  readonly email: string | null;
  readonly telephone: string | null;
  readonly adresse: string | null;
  readonly codePostal: string | null;
  readonly sousEmbargo: boolean;
  readonly canaux: CanauxAutorises;
  readonly base: string | null;
  readonly informeeLe: string | null;
}

/**
 * Applique l'EMBARGO.
 *
 * Tant que l'information de l'article 14 n'est pas partie, la route ne renvoie
 * NI téléphone, NI e-mail, NI adresse précise. Ce n'est pas un masquage côté
 * interface : le CORPS de la réponse ne les contient pas. Un champ masqué à
 * l'écran voyage quand même, et se lit dans l'onglet réseau.
 *
 * La ville reste : elle ne suffit pas à joindre quelqu'un, et sans elle
 * l'écran ne pourrait rien montrer d'utile.
 */
export function exposer(
  contact: ContactProspection,
  base: { base: BaseLegale; informeeLe: string | null } | null,
  canaux: CanauxAutorises,
): ContactExpose {
  const sousEmbargo =
    contact.type === "PARTICULIER" &&
    base?.base === "INTERET_LEGITIME_PARTICULIER" &&
    !base.informeeLe;

  return {
    id: contact.id,
    nom: contact.nom,
    type: contact.type,
    ville: contact.ville,
    email: sousEmbargo ? null : contact.email,
    telephone: sousEmbargo ? null : contact.telephone,
    adresse: sousEmbargo ? null : contact.adresse,
    codePostal: sousEmbargo ? null : contact.codePostal,
    sousEmbargo,
    canaux,
    base: base?.base ?? null,
    informeeLe: base?.informeeLe ?? null,
  };
}

// ── Jeton d'opposition ───────────────────────────────────────────────────────

/**
 * Pose un jeton d'opposition sur un contact et rend le jeton EN CLAIR.
 *
 * Seul son condensat va en base — même doctrine que le jeton d'acceptation de
 * devis. Le jeton ne vit que dans le lien inséré au message.
 */
export async function poserJetonOpposition(
  tenantId: string,
  contactId: string,
): Promise<string> {
  const jeton = randomUUID();
  await withTenant(tenantId, (tx) =>
    tx
      .update(contactsProspectionTable)
      .set({ oppositionTokenSha256: createHash("sha256").update(jeton).digest("hex") })
      .where(eq(contactsProspectionTable.id, contactId)),
  );
  return jeton;
}

/** Enregistre l'opposition d'une personne, sur toutes ses coordonnées. */
export async function enregistrerOpposition(
  tenantId: string,
  contact: ContactProspection,
  origine: string,
): Promise<void> {
  const lignes: Array<{ empreinte: string; nature: "email" | "telephone" }> = [];
  if (contact.email) {
    lignes.push({ empreinte: await empreinte(tenantId, "email", contact.email), nature: "email" });
  }
  if (contact.telephone) {
    lignes.push({
      empreinte: await empreinte(tenantId, "telephone", contact.telephone),
      nature: "telephone",
    });
  }
  if (lignes.length === 0) return;

  await withTenant(tenantId, async (tx) => {
    for (const l of lignes) {
      await tx.insert(oppositionsTable).values({ tenantId, ...l, origine });
    }
  });
}

// ── Purge ────────────────────────────────────────────────────────────────────

/** Charge un contact et tout ce qu'il faut pour décider. */
export async function chargerContact(
  tenantId: string,
  contactId: string,
): Promise<ContactProspection | null> {
  const [c] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(contactsProspectionTable)
      .where(and(eq(contactsProspectionTable.id, contactId))),
  );
  return c ?? null;
}
