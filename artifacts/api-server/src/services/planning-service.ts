/**
 * Pure planning calculation service.
 * No database access — all inputs are plain objects.
 * Fully testable without infrastructure.
 */

export type MemberRecord = {
  id: string;
  name: string;
  availability: string;
  schedule: Array<{ day: string; affaireId: string | null }>;
};

export type AbsenceRecord = {
  membreId: string;
  dateDebut: string;
  dateFin: string;
};

export type AffaireRecord = {
  id: string;
  label: string;
  status: string;
  quotedAmountCents: number | null;
  startDate: string | null;
  completedAt: string | null;
};

// ── Date helpers ──────────────────────────────────────────────────────────

export function getMondayOf(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  const dow = r.getUTCDay();
  r.setUTCDate(r.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseDate(s: string): Date {
  return new Date(s.slice(0, 10) + "T00:00:00Z");
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

// ── French public holidays ────────────────────────────────────────────────

/** Meeus/Jones/Butcher Easter algorithm — returns Easter Sunday in UTC. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** YYYY-MM-DD strings of French public holidays for a given year. */
export function getFeriesAnnee(year: number): Set<string> {
  const e = easterSunday(year);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return new Set([
    `${year}-01-01`,
    fmt(addDays(e, 1)),   // Easter Monday
    `${year}-05-01`,
    `${year}-05-08`,
    fmt(addDays(e, 39)),  // Ascension
    fmt(addDays(e, 50)),  // Whit Monday
    `${year}-07-14`,
    `${year}-08-15`,
    `${year}-11-01`,
    `${year}-11-11`,
    `${year}-12-25`,
  ]);
}

function buildFeriesSet(from: Date, weeks: number): Set<string> {
  const s = new Set<string>();
  const y1 = from.getUTCFullYear();
  const y2 = addDays(from, weeks * 7).getUTCFullYear();
  for (let y = y1; y <= y2; y++) for (const h of getFeriesAnnee(y)) s.add(h);
  return s;
}

// ── Shared constants ──────────────────────────────────────────────────────

export const WORK_STATUSES = new Set(["ACCEPTEE", "EN_COURS", "ACCEPTÉ", "ACCEPTÉE"]);
export const DEVIS_STATUSES = new Set(["DEVIS_ENVOYE", "DEVIS_ENVOYÉ"]);
const SCHEDULE_DAYS = ["LUN", "MAR", "MER", "JEU", "VEN"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────

function isMemberAbsent(dateStr: string, memberId: string, absences: AbsenceRecord[]): boolean {
  return absences.some(
    (a) => a.membreId === memberId && a.dateDebut <= dateStr && dateStr <= a.dateFin,
  );
}

/**
 * Returns the estimated end date for an affaire.
 * totalDays = quotedAmountCents / 100 / coutJourCharge (person-days of work).
 * We don't divide by member count — without schedule data we don't know staffing.
 * The effect is that a large affaire spans many weeks (conservative / correct for planning).
 */
function getAffaireEndDate(
  a: AffaireRecord,
  startDate: Date,
  coutJourCharge: number,
): Date {
  if (a.completedAt) return parseDate(a.completedAt);
  if (a.quotedAmountCents && coutJourCharge > 0) {
    const totalPersonDays = (a.quotedAmountCents / 100) / coutJourCharge;
    // Convert person-days to calendar days (5 workdays / 7 calendar days)
    const calendarDays = Math.ceil(totalPersonDays * 7 / 5);
    return addDays(startDate, calendarDays);
  }
  return addDays(startDate, 56); // 8-week default when no financial data
}

// ── Semaines ──────────────────────────────────────────────────────────────

export type ChantierItem = { id: string; label: string };

export type SemaineData = {
  dateDebut: string;         // Monday YYYY-MM-DD
  label: string;             // "Cette sem." / "11 août"
  type: "plein" | "partiel" | "libre";
  fillPct: number;
  chantiers: ChantierItem[];  // { id, label } — carries affaire id for clickable navigation
  absentsNoms: string[];
  joursLibres: number;
  joursDisponibles: number;
  joursVendus: number;
};

function frShortDate(monday: Date, isFirst: boolean): string {
  if (isFirst) return "Cette sem.";
  const d = monday.getUTCDate();
  const M = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
    "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  return `${d} ${M[monday.getUTCMonth()]}`;
}

export function buildSemaines(params: {
  today: Date;
  members: MemberRecord[];
  absences: AbsenceRecord[];
  affaires: AffaireRecord[];
  weekCount: number;
  tauxJourFacture: number;
  coutJourCharge: number;
}): SemaineData[] {
  const { today, members, absences, affaires, weekCount, tauxJourFacture, coutJourCharge } = params;
  const activeMembers = members.filter((m) => m.availability !== "ABSENT");
  const mondayOfToday = getMondayOf(today);
  const todayStr = toISODate(today);
  const feries = buildFeriesSet(mondayOfToday, weekCount + 2);

  // Build date-range index for ACCEPTEE/EN_COURS affaires.
  // Sold work derives purely from affaire date windows — no member schedule assignment needed.
  type AffaireRange = { label: string; startStr: string; endStr: string };
  const affaireRanges = new Map<string, AffaireRange>();
  for (const a of affaires) {
    if (!WORK_STATUSES.has(a.status)) continue;
    const rawStart = a.startDate ? parseDate(a.startDate) : parseDate(todayStr);
    // Use rawStart as the window start even if in the past (shows ongoing work)
    const endDate = getAffaireEndDate(a, rawStart, coutJourCharge);
    affaireRanges.set(a.id, {
      label: a.label,
      startStr: toISODate(rawStart),
      endStr: toISODate(endDate),
    });
  }

  const semaines: SemaineData[] = [];

  for (let w = 0; w < weekCount; w++) {
    const monday = addDays(mondayOfToday, w * 7);
    const mondayStr = toISODate(monday);

    // ── Step 1: Team disponibilité for this week ───────────────────────────
    // Count non-holiday, non-absent working days across all active members.
    let rawPersonDays = 0;
    const absentsSet = new Set<string>();

    for (const member of activeMembers) {
      for (let di = 0; di < 5; di++) {
        const date = addDays(monday, di);
        const dateStr = toISODate(date);
        if (feries.has(dateStr)) continue;
        if (isMemberAbsent(dateStr, member.id, absences)) {
          absentsSet.add(member.name);
          continue;
        }
        rawPersonDays++;
      }
    }
    const joursDisponibles = Math.round(rawPersonDays * tauxJourFacture);

    // ── Step 2: Sold work from affaire date windows ────────────────────────
    // For each ACCEPTEE/EN_COURS affaire, count working days in this week
    // that fall within the affaire's estimated date window. These days are
    // "sold" regardless of whether any member has that affaire in their schedule.
    // We cap total joursVendus at joursDisponibles (can't sell more than capacity).
    let rawVendus = 0;
    // Map<affaireId, ChantierItem> — preserves insertion order, deduplicates by id
    const chantiersMap = new Map<string, ChantierItem>();

    for (const [affaireId, range] of affaireRanges) {
      let daysInWeek = 0;
      for (let di = 0; di < 5; di++) {
        const dateStr = toISODate(addDays(monday, di));
        if (feries.has(dateStr)) continue;
        if (dateStr >= range.startStr && dateStr <= range.endStr) {
          daysInWeek++;
        }
      }
      if (daysInWeek > 0) {
        chantiersMap.set(affaireId, { id: affaireId, label: range.label });
        rawVendus += daysInWeek;
      }
    }

    const joursVendus = Math.min(joursDisponibles, rawVendus);
    const joursLibres = Math.max(0, joursDisponibles - joursVendus);
    const fillPct = joursDisponibles > 0
      ? Math.min(100, Math.round((joursVendus / joursDisponibles) * 100))
      : 0;
    const type: SemaineData["type"] =
      joursVendus === 0 ? "libre" : joursLibres > 0 ? "partiel" : "plein";

    semaines.push({
      dateDebut: mondayStr,
      label: frShortDate(monday, w === 0),
      type,
      fillPct,
      chantiers: [...chantiersMap.values()],
      absentsNoms: [...absentsSet],
      joursLibres,
      joursDisponibles,
      joursVendus,
    });
  }

  return semaines;
}

// ── Horizon ───────────────────────────────────────────────────────────────

export type HorizonResult = {
  horizon: string | null;
  phrase: string;
  sous: string;
  activeCount: number;
};

function frLongDate(d: Date): string {
  const M = ["janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]}`;
}

export function calcHorizon(semaines: SemaineData[], activeCount: number): HorizonResult {
  if (activeCount === 0) {
    return {
      horizon: null,
      phrase: "Votre équipe est vide.",
      sous: "Ajoutez des collaborateurs pour suivre le planning.",
      activeCount,
    };
  }

  let lastWorkingIdx = -1;
  for (let i = 0; i < semaines.length; i++) {
    if (semaines[i]!.type !== "libre") lastWorkingIdx = i;
  }

  if (lastWorkingIdx === -1) {
    return {
      horizon: null,
      phrase: "Vous n'avez rien de prévu.",
      sous: "Aucun chantier n'est planifié dans les prochaines semaines.",
      activeCount,
    };
  }

  // If last working week is the final one — look full
  if (lastWorkingIdx === semaines.length - 1) {
    return {
      horizon: null,
      phrase: "Vous êtes complet sur les prochaines semaines.",
      sous: "Tous les créneaux sont occupés.",
      activeCount,
    };
  }

  // Need ≥ 2 consecutive libre weeks after last working week to confirm the horizon
  const afterLibre = semaines.slice(lastWorkingIdx + 1);
  const has2Consec = afterLibre.length >= 2 && afterLibre[0]!.type === "libre" && afterLibre[1]!.type === "libre";

  if (!has2Consec) {
    return {
      horizon: null,
      phrase: "Vous êtes complet sur les prochaines semaines.",
      sous: "Tous les créneaux sont occupés.",
      activeCount,
    };
  }

  const lastFriday = addDays(parseDate(semaines[lastWorkingIdx]!.dateDebut), 4);
  const horizonStr = toISODate(lastFriday);
  const label = frLongDate(lastFriday);
  const compagnon =
    activeCount === 1 ? "votre compagnon n'a" : `vos ${activeCount} compagnons n'ont`;

  return {
    horizon: horizonStr,
    phrase: `Vous avez du travail jusqu'au ${label}.`,
    sous: `Après cette date, ${compagnon} rien de prévu.`,
    activeCount,
  };
}

// ── Devis en attente ──────────────────────────────────────────────────────

export type DevisResult = { count: number; semainesPotentielles: number };

export function calcDevisEnAttente(
  affaires: AffaireRecord[],
  coutJourCharge: number,
  avgJoursDispoParSemaine: number,
): DevisResult {
  const devis = affaires.filter((a) => DEVIS_STATUSES.has(a.status));
  if (devis.length === 0) return { count: 0, semainesPotentielles: 0 };

  const ref = Math.max(1, avgJoursDispoParSemaine);
  const totalDays = devis.reduce((sum, a) => {
    if (a.quotedAmountCents && coutJourCharge > 0)
      return sum + Math.max(1, Math.round(a.quotedAmountCents / 100 / coutJourCharge));
    return sum + 5;
  }, 0);

  return { count: devis.length, semainesPotentielles: Math.max(1, Math.round(totalDays / ref)) };
}

// ── Simulateur ────────────────────────────────────────────────────────────

export type SimulateurResult = {
  possible: boolean;
  dateDebutISO: string | null;
  dateDebutLabel: string;
  detail: string;
  decalageNecessaire: boolean;
};

export function simulerChantier(params: {
  joursNecessaires: number;
  personnesNecessaires: number;
  semaines: SemaineData[];
  activeCount: number;
}): SimulateurResult {
  const { joursNecessaires, personnesNecessaires, semaines, activeCount } = params;
  if (activeCount === 0 || semaines.length === 0) {
    return {
      possible: false,
      dateDebutISO: null,
      dateDebutLabel: "",
      detail: "Votre équipe est vide.",
      decalageNecessaire: false,
    };
  }

  const pers = Math.max(1, personnesNecessaires);

  // Must have enough team members for the job
  if (pers > activeCount) {
    return {
      possible: false,
      dateDebutISO: null,
      dateDebutLabel: "",
      detail: `Ce chantier nécessite ${pers} personne${pers > 1 ? "s" : ""} mais votre équipe n'en compte que ${activeCount}.`,
      decalageNecessaire: false,
    };
  }

  // Conservative per-person check: assume free days are distributed evenly.
  // We need each of the `pers` assignees to have at least `joursNecessaires` free days.
  // Using the average (joursLibres / activeCount) as a proxy:
  //   if the average person has >= joursNecessaires free days, there is very likely a slot.
  // This rejects weeks where free days are concentrated in too few people
  // (e.g., 1 person has 6 days free but we need 2 people × 3 days each).
  for (const sem of semaines) {
    const freePerPersonAvg = activeCount > 0 ? sem.joursLibres / activeCount : 0;
    if (freePerPersonAvg >= joursNecessaires) {
      const label = frLongDate(parseDate(sem.dateDebut));
      const libres = sem.joursLibres;
      return {
        possible: true,
        dateDebutISO: sem.dateDebut,
        dateDebutLabel: label,
        detail: `Il reste en moyenne ${(libres / activeCount).toFixed(1)} jour${libres > 1 ? "s" : ""} libre${libres > 1 ? "s" : ""} par personne sur cette semaine. Aucun chantier en cours n'est décalé.`,
        decalageNecessaire: false,
      };
    }
  }

  return {
    possible: false,
    dateDebutISO: null,
    dateDebutLabel: "",
    detail: `Aucun créneau disponible dans les ${semaines.length} prochaines semaines (${joursNecessaires} jour${joursNecessaires > 1 ? "s" : ""} par personne, ${pers} personne${pers > 1 ? "s" : ""} nécessaire${pers > 1 ? "s" : ""}).`,
    decalageNecessaire: true,
  };
}

// ── Vos journées ──────────────────────────────────────────────────────────

export type JourneesEtat = "COMPLET" | "INCOMPLET" | "SANS_DONNEES" | "PARAMETRES_MANQUANTS";

export type JourneesResult = {
  etat: JourneesEtat;
  moisLabel: string;
  /**
   * For INCOMPLET: a human-readable reason the full calculation is unavailable.
   * For COMPLET: all numeric fields are present.
   * For SANS_DONNEES / PARAMETRES_MANQUANTS: no numeric fields.
   */
  incompletRaison?: string;
  joursFactures?: number;
  joursPaies?: number;
  objectif?: number;
  ecartEuros?: number;
  coutDemiJournee?: number;
};

export function calcJournees(params: {
  prevMonthISO: string;
  caRealiseCents: number;
  activeCount: number;
  tauxJourFacture: number;
  coutJourCharge: number;
  parametresManquants: boolean;
}): JourneesResult {
  const {
    prevMonthISO,
    caRealiseCents,
    activeCount,
    tauxJourFacture,
    coutJourCharge,
    parametresManquants,
  } = params;

  const [y, m] = prevMonthISO.split("-").map(Number) as [number, number];
  const MN = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  const moisLabel = `${MN[m - 1]} ${y}`;

  if (parametresManquants) return { etat: "PARAMETRES_MANQUANTS", moisLabel };

  // SANS_DONNEES: no invoices for the period — nothing to analyse.
  if (caRealiseCents === 0) return { etat: "SANS_DONNEES", moisLabel };

  // INCOMPLET: we have invoice revenue but are missing something needed to compute
  // days-per-person (e.g. no active team members or zero daily cost configured).
  if (activeCount === 0) {
    return {
      etat: "INCOMPLET",
      moisLabel,
      incompletRaison: "Aucun membre actif dans l'équipe ce mois-ci.",
    };
  }
  if (coutJourCharge <= 0) {
    return {
      etat: "INCOMPLET",
      moisLabel,
      incompletRaison: "Le coût d'une journée n'est pas configuré (Paramètres → Équipe).",
    };
  }

  const WEEKS = 4.33;
  const joursPaies = 5;
  const objectif = Math.round(tauxJourFacture * 5 * 10) / 10;

  // Billed days per person per week = revenue / daily-cost / active-count / avg-weeks-per-month
  const joursFactures =
    Math.round((caRealiseCents / 100 / coutJourCharge / activeCount / WEEKS) * 10) / 10;

  const ecartParPers = joursFactures - objectif;
  const ecartEuros = Math.round(ecartParPers * coutJourCharge * activeCount * WEEKS);
  const coutDemiJournee = Math.round(0.5 * coutJourCharge * activeCount * WEEKS);

  return { etat: "COMPLET", moisLabel, joursFactures, joursPaies, objectif, ecartEuros, coutDemiJournee };
}
