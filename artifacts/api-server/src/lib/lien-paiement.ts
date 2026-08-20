/**
 * Émission d'un lien de paiement à la suite d'un appel — ticket 4.19, lot B.
 *
 * Le constat qui ouvre le chantier : « oui oui je vais payer » ne vaut rien.
 * Un lien envoyé pendant que la personne est encore au téléphone, lui, est
 * exécutable dans la minute.
 *
 * ── Ce qui vient d'où, et pourquoi ça compte ──────────────────────────────
 * MONTANT   : de l'entrée de campagne (la facture), ou de la promesse déjà
 *             enregistrée par `record_promise`. JAMAIS d'un corps de requête,
 *             jamais du modèle — règle 3 : le modèle ne fixe pas un prix.
 * NUMÉRO    : de l'entrée de campagne, comme pour l'opposition. Un SMS
 *             envoyé au numéro qu'un LLM aurait dicté est un SMS envoyé à
 *             n'importe qui.
 * IBAN      : du réglage `company.iban` du tenant, validé à l'écriture.
 * MANDAT    : `lienPaiementAutorise` du mandat FIGÉ de la campagne — la
 *             version sous laquelle le dirigeant a validé, pas la règle du
 *             jour (US-9).
 *
 * ── L'ordre des opérations n'est pas indifférent ──────────────────────────
 * La ligne est écrite AVANT l'appel à Bridge, avec son identifiant : c'est
 * lui qui part en `client_reference` et qui reviendra dans le webhook. Écrire
 * après aurait laissé une fenêtre où un paiement arrive avant que la ligne
 * qu'il concerne existe.
 */

import { eq } from "drizzle-orm";
import {
  withTenant,
  liensPaiementTable,
  appelsRelanceTable,
  campagnesRelanceTable,
} from "@workspace/db";
import { creerLienPaiement, getConfig, BanqueConfigError } from "@nodaq/banque-agreee";
import { loadCompanySettings } from "./seller-info.js";
import { empreinte } from "./prospection.js";
import { numeroAutoriseEnTest } from "./numeros-test.js";
import { envoyerSms, texteSmsLienPaiement } from "./sms.js";
import { logger } from "./logger.js";

/** Durée de vie d'un lien. Un lien de relance qui traîne perd son sens. */
export const VALIDITE_LIEN_JOURS = 7;

export type ResultatLienPaiement =
  | { kind: "envoye"; lienId: string; url: string; montantCents: number }
  | { kind: "non_configure" }
  | { kind: "sans_iban" }
  | { kind: "hors_mandat" }
  | { kind: "numero_refuse" }
  | { kind: "montant_inconnu" }
  | { kind: "refuse_banque" }
  | { kind: "sms_non_parti"; lienId: string; url: string };

/** Montant en euros, écrit pour être lu dans un SMS. */
function montantLisible(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/**
 * Le contexte de l'appel : montant dû, numéro, mandat — tout lu en base.
 *
 * Le montant retenu est celui de la PROMESSE si elle a été enregistrée (la
 * personne s'est engagée sur ce montant-là, et un lien d'un autre montant
 * serait un désaveu), sinon le solde de la facture.
 */
async function contexteDeLAppel(tenantId: string, appelId: string) {
  return withTenant(tenantId, async (tx) => {
    const [appel] = await tx
      .select({
        campagneId: appelsRelanceTable.campagneId,
        factureId: appelsRelanceTable.factureId,
        clientId: appelsRelanceTable.clientId,
        promesseMontantCents: appelsRelanceTable.promesseMontantCents,
      })
      .from(appelsRelanceTable)
      .where(eq(appelsRelanceTable.id, appelId));
    if (!appel) return null;

    const [campagne] = await tx
      .select({ appels: campagnesRelanceTable.appels, mandat: campagnesRelanceTable.mandat })
      .from(campagnesRelanceTable)
      .where(eq(campagnesRelanceTable.id, appel.campagneId));

    const entrees = (campagne?.appels ?? []) as {
      factureId?: string;
      numero?: string;
      montantCents?: number;
      clientNom?: string;
    }[];
    const entree = entrees.find((e) => e.factureId === appel.factureId);
    if (!entree?.numero) return null;

    return {
      numero: entree.numero,
      clientNom: entree.clientNom ?? "",
      factureId: appel.factureId,
      clientId: appel.clientId,
      montantCents: appel.promesseMontantCents ?? entree.montantCents ?? 0,
      mandat: (campagne?.mandat ?? {}) as { lienPaiementAutorise?: boolean },
    };
  });
}

/**
 * Émet un lien de paiement pour l'appel donné, et l'envoie par SMS.
 *
 * Ne reçoit AUCUN montant ni numéro de son appelant : tout est lu en base
 * depuis l'identifiant d'appel, lui-même résolu par le jeton de l'appel en
 * cours (lot 6a). C'est ce qui rend l'outil sûr à exposer au modèle.
 */
export async function emettreLienPaiement(options: {
  tenantId: string;
  appelId: string;
}): Promise<ResultatLienPaiement> {
  const { tenantId, appelId } = options;

  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (err instanceof BanqueConfigError) return { kind: "non_configure" };
    throw err;
  }

  const contexte = await contexteDeLAppel(tenantId, appelId);
  if (!contexte) return { kind: "montant_inconnu" };

  // Le mandat FIGÉ de la campagne, pas la règle du jour (US-9).
  if (contexte.mandat.lienPaiementAutorise !== true) return { kind: "hors_mandat" };
  if (contexte.montantCents <= 0) return { kind: "montant_inconnu" };
  if (!numeroAutoriseEnTest(contexte.numero)) return { kind: "numero_refuse" };

  const reglages = await loadCompanySettings(tenantId);
  const iban = (reglages["company.iban"] as string | undefined)?.trim();
  const raisonSociale = (reglages["company.raison_sociale"] as string | undefined)?.trim();
  // Sans IBAN il n'y a pas de bénéficiaire ; sans raison sociale, le SMS est
  // indiscernable d'un hameçonnage. Ni l'un ni l'autre ne s'invente.
  if (!iban || !raisonSociale) return { kind: "sans_iban" };

  const empreinteNumero = await empreinte(tenantId, "telephone", contexte.numero);
  const expireLe = new Date(Date.now() + VALIDITE_LIEN_JOURS * 24 * 60 * 60 * 1000);

  // La ligne AVANT Bridge : son id part en référence et revient dans le
  // webhook. L'inverse laisserait un paiement arriver avant sa ligne.
  const lienId = await withTenant(tenantId, async (tx) => {
    const [cree] = await tx
      .insert(liensPaiementTable)
      .values({
        tenantId,
        appelId,
        factureId: contexte.factureId,
        clientId: contexte.clientId,
        empreinteNumero,
        montantCents: contexte.montantCents,
        statut: "EMIS",
        expireLe,
      })
      .returning({ id: liensPaiementTable.id });
    return cree!.id;
  });

  let lien;
  try {
    lien = await creerLienPaiement(config, {
      montantCents: contexte.montantCents,
      beneficiaireIban: iban,
      beneficiaireNom: raisonSociale,
      libelle: contexte.factureId ? `Facture ${contexte.factureId}` : "Règlement facture",
      payeurNom: contexte.clientNom || "Client",
      reference: lienId,
      expireLe,
    });
  } catch (err) {
    // Le corps d'erreur de Bridge peut reprendre l'IBAN : jamais journalisé.
    logger.error(
      { erreur: err instanceof Error ? err.name : "inconnue" },
      "[lien-paiement] création refusée",
    );
    await withTenant(tenantId, (tx) =>
      tx.update(liensPaiementTable).set({ statut: "ECHEC" }).where(eq(liensPaiementTable.id, lienId)),
    );
    return { kind: "refuse_banque" };
  }

  await withTenant(tenantId, (tx) =>
    tx
      .update(liensPaiementTable)
      .set({ bridgeLinkId: lien.id, url: lien.url })
      .where(eq(liensPaiementTable.id, lienId)),
  );

  const sms = await envoyerSms(
    contexte.numero,
    texteSmsLienPaiement(raisonSociale, montantLisible(contexte.montantCents), lien.url),
  );

  // Le lien EXISTE même si le SMS n'est pas parti : le dirigeant peut le
  // renvoyer depuis le cockpit. Le dire plutôt que de laisser croire à un
  // envoi — c'est ce que l'agent annoncera à la personne.
  if (sms.kind !== "envoye") return { kind: "sms_non_parti", lienId, url: lien.url };

  return { kind: "envoye", lienId, url: lien.url, montantCents: contexte.montantCents };
}
