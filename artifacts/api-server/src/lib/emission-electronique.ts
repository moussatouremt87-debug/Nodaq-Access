/**
 * Blocage d'émission non conforme (US-A2.6) — modèle exact d'auditMentionsFR
 * (pdf-generation.ts) : même forme `{code, message, bloquant}[]`, même
 * réponse 422 côté route.
 *
 * Différence assumée : gardé par une DATE D'APPLICABILITÉ plutôt qu'actif
 * en permanence. L'émission électronique obligatoire pour les TPE/PME — la
 * base clients NODAQ (CLAUDE.md) — n'entre en vigueur que le 1er septembre
 * 2027 (grandes entreprises/ETI : 1er septembre 2026, hors périmètre ici,
 * voir le plan US-A2.6). Avant cette date, `auditEmissionElectronique` est
 * un no-op garanti — jamais un interrupteur manuel à ne pas oublier de
 * basculer : la date fait le travail, une fois pour toutes.
 *
 * `today` est un PARAMÈTRE, pas `new Date()` interne : la règle est
 * testable sans attendre 2027 ni truquer l'horloge système.
 */
import { toDateString } from "@nodaq/shared";
import type { MentionIssue } from "./pdf-generation.js";

/** Échéance TPE/PME — voir le plan US-A2.6 pour la source réglementaire. */
export const OBLIGATION_EMISSION_ELECTRONIQUE_DATE = "2027-09-01";

export function auditEmissionElectronique(today: Date, paConfiguree: boolean): MentionIssue[] {
  if (toDateString(today) < OBLIGATION_EMISSION_ELECTRONIQUE_DATE) return [];
  if (paConfiguree) return [];

  return [
    {
      code: "plateforme_agreee_non_configuree",
      message:
        "L'émission électronique est obligatoire depuis le 1er septembre 2027. " +
        "Configurez votre connexion à une plateforme agréée (Facturation électronique) avant d'émettre.",
      bloquant: true,
    },
  ];
}
