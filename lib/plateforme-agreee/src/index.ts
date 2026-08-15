export { getConfig, submitInvoice, fetchInboundDocuments } from "./client.js";
export type {
  PaConfig,
  PaDocumentType,
  SubmitInvoiceInput,
  SubmitInvoiceResult,
  InboundDocument,
} from "./client.js";
export { PaConfigError, PaNetworkError, PaResponseError } from "./errors.js";

// Vocabulaire de statuts déjà normatif (sourcé DGFiP) dans @nodaq/facturx —
// réexporté ici plutôt que dupliqué, pour que les appelants n'aient qu'un
// seul paquet à connaître pour le cycle de vie d'une transmission PA.
export {
  isRejection,
  isValidTransition,
  LIFECYCLE_RULES_VERSION,
  LIFECYCLE_SOURCE,
  normalizeStatus,
  STATUS_LABELS,
  SUBMISSION_STATUSES,
  TERMINAL_STATUSES,
} from "@nodaq/facturx";
export type { SubmissionStatus } from "@nodaq/facturx";
