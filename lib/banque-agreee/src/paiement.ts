/**
 * Bridge — initiation de paiement par LIEN (ticket 4.19).
 *
 * Prolonge le connecteur « Banque » : le même compte plateforme, les mêmes
 * clés, la même discipline. Ce fichier vit dans `lib/banque-agreee` et NON
 * dans l'api-server pour une raison précise : la garde
 * `banque-agreee-single-exit.test.ts` interdit de lire `BRIDGE_*` ailleurs
 * que dans ce paquet. Le point de sortie reste unique.
 *
 * ── L'usage change de nature, et c'est dit ────────────────────────────────
 * Jusqu'ici Bridge LISAIT des comptes. Il DÉCLENCHE désormais un mouvement
 * d'argent. Le registre de souveraineté (`souverainete.ts`) et l'ADR du
 * connecteur bancaire doivent le refléter avant toute exposition à un tenant :
 * une entrée « agrégation » ne couvre pas une initiation.
 *
 * ── Contrat sourcé le 2026-08-20 ──────────────────────────────────────────
 * POST /v3/payment/payment-links (docs.bridgeapi.io/reference/createpaymentlink)
 *   en-têtes : Client-Id, Client-Secret, Bridge-Version
 *   corps    : user{}, transactions[{ amount, currency, label, beneficiary{} }],
 *              client_reference, expired_date, callback_url
 *   réponse  : { id, url }
 *
 * Le montant est en unité MAJEURE côté Bridge (`amount` flottant, EUR) alors
 * que tout le produit compte en CENTIMES entiers. La conversion se fait ICI,
 * une seule fois, et jamais dans l'appelant — c'est le même piège que le
 * `balance` de `listerComptes`, noté en tête de `client.ts`.
 *
 * PRÉREQUIS COMPTE : le produit « paiement » doit être activé chez Bridge.
 * Sans activation, l'API répond une erreur d'autorisation ; elle remonte
 * telle quelle en `BanqueNetworkError` plutôt que d'être devinée ici.
 */

import { getConfig, type BanqueConfig } from "./client.js";
import { BanqueNetworkError, BanqueResponseError } from "./errors.js";

const BRIDGE_BASE_URL = "https://api.bridgeapi.io";
const BRIDGE_VERSION = "2025-01-15";

export interface DemandeLienPaiement {
  /** Montant demandé, en CENTIMES entiers — converti pour Bridge ici même. */
  readonly montantCents: number;
  /** Le bénéficiaire : le compte de l'artisan, jamais un compte NODAQ. */
  readonly beneficiaireIban: string;
  readonly beneficiaireNom: string;
  /** Ce que le débiteur lira sur son relevé (50 caractères max côté Bridge). */
  readonly libelle: string;
  /** Le payeur, tel qu'affiché dans le tunnel Bridge. */
  readonly payeurNom: string;
  /** Notre identifiant de lien — c'est lui qui reviendra dans le webhook. */
  readonly reference: string;
  /** Fin de validité. Un lien de relance qui traîne perd son sens. */
  readonly expireLe: Date;
  /** Page de retour après paiement. */
  readonly callbackUrl?: string;
}

export interface LienPaiementCree {
  /** Identifiant Bridge du lien. */
  readonly id: string;
  /** URL à envoyer au débiteur. */
  readonly url: string;
}

/** Longueurs maximales imposées par Bridge — tronquer vaut mieux qu'un 400. */
const MAX_LIBELLE = 50;
const MAX_NOM = 35;

/**
 * Crée un lien de paiement Bridge.
 *
 * Ne journalise que le code HTTP et la durée : ni IBAN, ni montant, ni nom
 * (règle 6). Le corps d'erreur de Bridge n'est PAS journalisé non plus — il
 * peut reprendre les champs envoyés — mais il est porté par l'exception, où
 * l'appelant décide quoi en faire.
 */
export async function creerLienPaiement(
  config: BanqueConfig,
  demande: DemandeLienPaiement,
): Promise<LienPaiementCree> {
  if (!Number.isInteger(demande.montantCents) || demande.montantCents <= 0) {
    throw new BanqueResponseError("creerLienPaiement : montantCents doit être un entier positif");
  }

  const t0 = Date.now();
  let httpStatus = 0;
  try {
    const res = await fetch(`${BRIDGE_BASE_URL}/v3/payment/payment-links`, {
      method: "POST",
      headers: {
        "Bridge-Version": BRIDGE_VERSION,
        "Client-Id": config.clientId,
        "Client-Secret": config.clientSecret,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user: { company_name: demande.payeurNom.slice(0, MAX_NOM) },
        client_reference: demande.reference,
        expired_date: demande.expireLe.toISOString(),
        ...(demande.callbackUrl ? { callback_url: demande.callbackUrl } : {}),
        transactions: [
          {
            // Centimes → unité majeure. Une division qui se perdrait dans un
            // appelant produirait un lien à 100 fois le montant dû.
            amount: demande.montantCents / 100,
            currency: "EUR",
            label: demande.libelle.slice(0, MAX_LIBELLE),
            client_reference: demande.reference,
            beneficiary: {
              iban: demande.beneficiaireIban,
              company_name: demande.beneficiaireNom.slice(0, MAX_NOM),
            },
          },
        ],
      }),
    });
    httpStatus = res.status;

    if (!res.ok) {
      const corps = await res.text().catch(() => "(no body)");
      throw new BanqueNetworkError(res.status, corps);
    }

    const data = (await res.json().catch(() => {
      throw new BanqueResponseError("creerLienPaiement : réponse non-JSON");
    })) as { id?: string; url?: string };

    console.info(
      "[banque-agreee] créer lien paiement ok",
      JSON.stringify({ status: httpStatus, durationMs: Date.now() - t0 }),
    );

    if (typeof data.id !== "string" || typeof data.url !== "string") {
      throw new BanqueResponseError("creerLienPaiement : id ou url manquant");
    }
    return { id: data.id, url: data.url };
  } catch (err) {
    console.info(
      "[banque-agreee] créer lien paiement error",
      JSON.stringify({ status: httpStatus, durationMs: Date.now() - t0 }),
    );
    throw err;
  }
}

/** Réexporté pour que l'appelant n'ait pas à connaître deux modules. */
export { getConfig };
