/**
 * Plateforme agréée (PA) — point de sortie UNIQUE pour l'échange de factures
 * électroniques (US-A2.6, réforme de facturation électronique française).
 *
 * INVARIANT (même discipline que `lib/llm`) : ce fichier n'importe jamais de
 * SDK fournisseur. Toute communication passe par `fetch`. Toute destination
 * vient de `PA_BASE_URL`, résolue par `getConfig()` — jamais de valeur par
 * défaut, jamais une URL en dur ailleurs dans le dépôt. La garde
 * `plateforme-agreee-single-exit.test.ts` fait respecter cet invariant.
 *
 * CONTRAT PROVISOIRE. Au 2026-08-15, NODAQ n'a pas encore choisi/contracté de
 * plateforme agréée (PA) — le choix et le contrat sont un sujet
 * business/juridique distinct du travail technique (voir le plan US-A2.6).
 * Le contrat REST ci-dessous (`POST /invoices`, `GET /documents`) est une
 * hypothèse raisonnable, PAS une spécification connue d'un fournisseur réel.
 * Le jour où un contrat existe, seules les fonctions de ce fichier doivent
 * changer — statuts (`@nodaq/facturx`), stockage et écrans n'ont pas à
 * bouger.
 */

import { PaConfigError, PaNetworkError, PaResponseError } from "./errors.js";
import type { SubmissionStatus } from "@nodaq/facturx";

// ─── Config resolution ──────────────────────────────────────────────────────

export interface PaConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * Resolve PA config from environment variables.
 *
 * Reads: PA_BASE_URL, PA_API_KEY. No default values — every missing variable
 * throws PaConfigError. A caller must catch PaConfigError and respond 503,
 * exactly like the LLM_BASE_URL routes do for LlmConfigError.
 */
export function getConfig(): PaConfig {
  const baseUrl = process.env["PA_BASE_URL"];
  if (!baseUrl) throw new PaConfigError("PA_BASE_URL");

  const apiKey = process.env["PA_API_KEY"];
  if (!apiKey) throw new PaConfigError("PA_API_KEY");

  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

// ─── Outbound submission (facture ou agrégat e-reporting) ──────────────────

export type PaDocumentType = "FACTURE" | "E_REPORTING";

export interface SubmitInvoiceInput {
  documentType: PaDocumentType;
  /** Identifiant du document côté NODAQ (id de facture, ou clé de période pour l'e-reporting). */
  documentId: string;
  /** XML CII pour une facture ; JSON sérialisé de l'agrégat pour l'e-reporting. */
  payload: string;
  /** PDF Factur-X complet — requis pour une facture, absent pour l'e-reporting. */
  pdfBytes?: Buffer;
}

export interface SubmitInvoiceResult {
  /** Identifiant attribué par la PA — à conserver pour le suivi de statut. */
  submissionId: string;
  status: SubmissionStatus;
}

/**
 * Dépose un document (facture ou agrégat e-reporting) auprès de la PA.
 *
 * Journalisation : nom du document, statut HTTP, durée — jamais le contenu
 * (même discipline que `lib/llm`, CLAUDE.md §6).
 */
export async function submitInvoice(
  config: PaConfig,
  input: SubmitInvoiceInput,
): Promise<SubmitInvoiceResult> {
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    documentType: input.documentType,
    documentId: input.documentId,
    payload: input.payload,
  };
  if (input.pdfBytes) {
    body["pdfBase64"] = input.pdfBytes.toString("base64");
  }

  let httpStatus = 0;
  try {
    const res = await fetch(`${config.baseUrl}/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    httpStatus = res.status;
    const durationMs = Date.now() - t0;

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "(no body)");
      console.info(
        "[plateforme-agreee] submit failed",
        JSON.stringify({ documentType: input.documentType, status: httpStatus, durationMs }),
      );
      throw new PaNetworkError(res.status, errorBody);
    }

    const data = (await res.json()) as { submissionId?: string; status?: string };
    console.info(
      "[plateforme-agreee] submit ok",
      JSON.stringify({ documentType: input.documentType, status: httpStatus, durationMs }),
    );

    if (typeof data.submissionId !== "string" || typeof data.status !== "string") {
      throw new PaResponseError("missing submissionId or status");
    }

    return { submissionId: data.submissionId, status: data.status as SubmissionStatus };
  } catch (err) {
    if (err instanceof PaNetworkError || err instanceof PaResponseError) throw err;
    const durationMs = Date.now() - t0;
    console.info(
      "[plateforme-agreee] submit error",
      JSON.stringify({ documentType: input.documentType, status: httpStatus, durationMs }),
    );
    throw err;
  }
}

// ─── Inbound documents (réception) ──────────────────────────────────────────

export interface InboundDocument {
  /** Identifiant attribué par la PA. */
  id: string;
  receivedAt: string;
  /** Octets du Factur-X reçu. */
  pdfBytes: Buffer;
  sha256: string;
}

/**
 * Récupère les documents reçus par la PA depuis `sinceIso` (ISO 8601), ou
 * tout l'historique disponible si absent. Polling, pas un webhook — voir
 * PR2 du plan US-A2.6 pour l'ébauche de webhook entrant, qui appelle ce même
 * client une fois un contrat PA disponible.
 */
export async function fetchInboundDocuments(
  config: PaConfig,
  sinceIso?: string,
): Promise<InboundDocument[]> {
  const t0 = Date.now();
  const url = new URL(`${config.baseUrl}/documents`);
  if (sinceIso) url.searchParams.set("since", sinceIso);

  let httpStatus = 0;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });

    httpStatus = res.status;
    const durationMs = Date.now() - t0;

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "(no body)");
      console.info(
        "[plateforme-agreee] fetch inbound failed",
        JSON.stringify({ status: httpStatus, durationMs }),
      );
      throw new PaNetworkError(res.status, errorBody);
    }

    const data = (await res.json()) as {
      documents?: Array<{ id?: string; receivedAt?: string; pdfBase64?: string; sha256?: string }>;
    };
    console.info(
      "[plateforme-agreee] fetch inbound ok",
      JSON.stringify({ status: httpStatus, durationMs, count: data.documents?.length ?? 0 }),
    );

    if (!Array.isArray(data.documents)) {
      throw new PaResponseError("missing documents array");
    }

    return data.documents.map((d, i) => {
      if (
        typeof d.id !== "string" ||
        typeof d.receivedAt !== "string" ||
        typeof d.pdfBase64 !== "string" ||
        typeof d.sha256 !== "string"
      ) {
        throw new PaResponseError(`document[${i}] is missing required fields`);
      }
      return {
        id: d.id,
        receivedAt: d.receivedAt,
        pdfBytes: Buffer.from(d.pdfBase64, "base64"),
        sha256: d.sha256,
      };
    });
  } catch (err) {
    if (err instanceof PaNetworkError || err instanceof PaResponseError) throw err;
    const durationMs = Date.now() - t0;
    console.info("[plateforme-agreee] fetch inbound error", JSON.stringify({ status: httpStatus, durationMs }));
    throw err;
  }
}
