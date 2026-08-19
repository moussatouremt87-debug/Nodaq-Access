/**
 * Appels de relance : opposition, éligibilité, effacement — ticket 4.18.
 *
 * ── L'opposition réutilise `oppositions`, elle n'en crée pas une seconde ──
 * L'US-7 demande un « ne me rappelez plus » définitif. Ce mécanisme existe
 * déjà, avec la bonne doctrine : l'opposition porte sur une EMPREINTE SALÉE de
 * la coordonnée, pas sur l'identifiant du contact — « c'est la personne qu'on
 * a exclue, pas la ligne ». Un second registre, propre au vocal, aurait donné
 * deux vérités sur la même question, et la plus permissive aurait gagné le
 * jour où l'une aurait été oubliée.
 *
 * ── L'effacement arrive AVEC les transcriptions ──────────────────────────
 * L'US-8 exige qu'effacer un contact emporte ses appels, transcriptions et
 * promesses. C'est écrit ici, dans le lot qui introduit ces données. Créer la
 * table d'abord et l'effacement « plus tard » reviendrait à accumuler du
 * nominatif en promettant de savoir le supprimer un jour.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  withTenant,
  appelsRelanceTable,
  oppositionsTable,
  clientsTable,
  type DrizzleTx,
} from "@workspace/db";
import { empreinte } from "./prospection.js";
import { frapperJetonAppel } from "./jeton-appel.js";

/** D'où vient l'opposition, pour la distinguer de celles de la prospection. */
export const ORIGINE_OPPOSITION_APPEL = "appel_vocal";

/**
 * Enregistre un « ne me rappelez plus » (US-7).
 *
 * Effectif immédiatement : la table est consultée avant chaque tentative, il
 * n'y a pas de cache à invalider. C'est ce que la story demande — « effectif
 * immédiatement », pas « à la prochaine campagne ».
 */
export async function poserOppositionAppel(tenantId: string, numero: string): Promise<void> {
  const emp = await empreinte(tenantId, "telephone", numero);
  await withTenant(tenantId, (tx) =>
    tx.insert(oppositionsTable).values({
      tenantId,
      empreinte: emp,
      nature: "telephone",
      origine: ORIGINE_OPPOSITION_APPEL,
    }),
  );
}

/** Ce numéro s'est-il opposé, quelle que soit l'origine de l'opposition ? */
export async function estOpposeAuxAppels(tenantId: string, numero: string): Promise<boolean> {
  const emp = await empreinte(tenantId, "telephone", numero);
  const lignes = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: oppositionsTable.id })
      .from(oppositionsTable)
      .where(eq(oppositionsTable.empreinte, emp)),
  );
  return lignes.length > 0;
}

/**
 * Les numéros opposés parmi ceux d'une campagne.
 *
 * En UNE requête plutôt qu'une par appel : une campagne de cent débiteurs
 * ferait cent allers-retours, et le worker vocal interroge cette fonction
 * juste avant de composer.
 */
export async function numerosOpposes(
  tenantId: string,
  numeros: readonly string[],
): Promise<Set<string>> {
  if (numeros.length === 0) return new Set();

  const parEmpreinte = new Map<string, string>();
  for (const n of numeros) parEmpreinte.set(await empreinte(tenantId, "telephone", n), n);

  const lignes = await withTenant(tenantId, (tx) =>
    tx
      .select({ empreinte: oppositionsTable.empreinte })
      .from(oppositionsTable)
      .where(inArray(oppositionsTable.empreinte, [...parEmpreinte.keys()])),
  );

  const opposes = new Set<string>();
  for (const l of lignes) {
    const numero = parEmpreinte.get(l.empreinte);
    if (numero) opposes.add(numero);
  }
  return opposes;
}

/** Combien de tentatives ont déjà été faites vers ce numéro, dans cette campagne. */
export async function tentativesFaites(
  tenantId: string,
  campagneId: string,
  numero: string,
): Promise<number> {
  const emp = await empreinte(tenantId, "telephone", numero);
  const lignes = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: appelsRelanceTable.id })
      .from(appelsRelanceTable)
      .where(
        and(
          eq(appelsRelanceTable.campagneId, campagneId),
          eq(appelsRelanceTable.empreinteNumero, emp),
        ),
      ),
  );
  return lignes.length;
}

// ── Effacement (US-8, RGPD art. 17) ────────────────────────────────────────

export interface BilanEffacement {
  readonly appelsEffaces: number;
  /** Vrai si une opposition existait : elle est CONSERVÉE, voir plus bas. */
  readonly oppositionConservee: boolean;
}

/**
 * Efface les données vocales d'une personne, par sa coordonnée.
 *
 * Ce qui part : les appels, donc les transcriptions, les résumés et les
 * promesses dérivées. C'est le périmètre exact de l'US-8.
 *
 * ── L'opposition, elle, RESTE ────────────────────────────────────────────
 * Et c'est volontaire, même si c'est contre-intuitif. Effacer l'opposition en
 * même temps que les appels rendrait la personne rappelable dès la campagne
 * suivante — l'effacement se retournerait contre celui qui le demande.
 * L'opposition ne porte d'ailleurs aucune donnée personnelle en clair : une
 * empreinte salée, non réversible, dont la conservation est l'intérêt
 * légitime même qui justifie son existence.
 */
export async function effacerDonneesVocales(
  tenantId: string,
  numero: string,
): Promise<BilanEffacement> {
  const emp = await empreinte(tenantId, "telephone", numero);

  return withTenant(tenantId, async (tx) => {
    const effaces = await tx
      .delete(appelsRelanceTable)
      .where(eq(appelsRelanceTable.empreinteNumero, emp))
      .returning({ id: appelsRelanceTable.id });

    const oppositions = await tx
      .select({ id: oppositionsTable.id })
      .from(oppositionsTable)
      .where(eq(oppositionsTable.empreinte, emp));

    return {
      appelsEffaces: effaces.length,
      oppositionConservee: oppositions.length > 0,
    };
  });
}

/**
 * Efface les données vocales rattachées à un client, avant sa suppression.
 *
 * Passe par le NUMÉRO et non par `client_id` : un appel dont le client a déjà
 * disparu porterait un `client_id` orphelin et survivrait à l'effacement.
 * C'est la même raison qui fait porter l'opposition sur l'empreinte.
 */
export async function effacerDonneesVocalesDuClient(
  tenantId: string,
  clientId: string,
): Promise<BilanEffacement> {
  const [client] = await withTenant(tenantId, (tx) =>
    tx
      .select({ telephone: clientsTable.telephone })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId)),
  );

  if (!client?.telephone) {
    // Sans numéro, il n'y a rien à rattacher : on efface tout de même par
    // `client_id`, pour ne pas laisser derrière soi des appels d'un client
    // dont on vient de demander l'effacement.
    const effaces = await withTenant(tenantId, (tx) =>
      tx
        .delete(appelsRelanceTable)
        .where(eq(appelsRelanceTable.clientId, clientId))
        .returning({ id: appelsRelanceTable.id }),
    );
    return { appelsEffaces: effaces.length, oppositionConservee: false };
  }

  return effacerDonneesVocales(tenantId, client.telephone);
}

/** Reste-t-il une trace vocale de cette coordonnée ? Sert au test d'effacement. */
export async function resteDesTracesVocales(
  tenantId: string,
  numero: string,
): Promise<boolean> {
  const emp = await empreinte(tenantId, "telephone", numero);
  const lignes = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: appelsRelanceTable.id })
      .from(appelsRelanceTable)
      .where(eq(appelsRelanceTable.empreinteNumero, emp)),
  );
  return lignes.length > 0;
}

/** Enregistre un appel passé. Le numéro n'est stocké que par son empreinte. */
export async function enregistrerAppel(
  tx: DrizzleTx,
  tenantId: string,
  appel: {
    campagneId: string;
    numero: string;
    empreinteNumero: string;
    clientId?: string | null;
    factureId?: string | null;
    tentative: number;
    statut: string;
    issue?: string | null;
    transcription?: string | null;
    resume?: string | null;
    coutMillicents?: number;
  },
): Promise<void> {
  // `numero` est reçu pour la symétrie de l'appelant mais n'est JAMAIS écrit :
  // seule l'empreinte entre en base.
  const { numero: _numero, ...aEcrire } = appel;
  void _numero;
  await tx.insert(appelsRelanceTable).values({ tenantId, ...aEcrire });
}

/**
 * Planifie un appel et rend le jeton que le worker devra présenter.
 *
 * Le jeton en clair est rendu UNE fois, ici, et n'est plus jamais relisible :
 * seul son condensat entre en base. C'est ce qui permet au worker de s'annoncer
 * sans jamais nommer de tenant — la résolution se fait depuis la ligne (voir
 * `requireAppelVocal`).
 *
 * Séparé de `enregistrerAppel` à dessein : cette fonction-là sert aussi à
 * consigner un appel DÉJÀ passé, qui n'a plus besoin de jeton. Frapper un
 * jeton dans tous les cas laisserait traîner des accès valides sur des lignes
 * qui n'en ont pas l'usage.
 */
export async function planifierAppel(
  tx: DrizzleTx,
  tenantId: string,
  appel: Parameters<typeof enregistrerAppel>[2],
): Promise<{ appelId: string; jeton: string }> {
  const { jeton, sha256 } = frapperJetonAppel();
  const { numero: _numero, ...aEcrire } = appel;
  void _numero;

  const [ligne] = await tx
    .insert(appelsRelanceTable)
    .values({ tenantId, ...aEcrire, statut: "PLANIFIE", jetonSha256: sha256 })
    .returning({ id: appelsRelanceTable.id });

  return { appelId: ligne!.id, jeton };
}

/**
 * Ferme un appel : plus aucun jeton ne vaut sur cette ligne.
 *
 * Le condensat est EFFACÉ en plus du changement de statut. La policy exigeait
 * déjà `statut IN ('PLANIFIE','EN_COURS')`, donc le statut suffirait — mais un
 * secret qu'on garde après son usage est un secret qu'on finit par fuiter, et
 * l'effacer rend la révocation vraie même si quelqu'un élargit la policy un
 * jour.
 */
export async function cloreAppel(
  tx: DrizzleTx,
  tenantId: string,
  appelId: string,
  statut: "TERMINE" | "ECHEC",
): Promise<void> {
  await tx
    .update(appelsRelanceTable)
    .set({ statut, jetonSha256: null, endedAt: new Date() })
    .where(
      and(eq(appelsRelanceTable.tenantId, tenantId), eq(appelsRelanceTable.id, appelId)),
    );
}
