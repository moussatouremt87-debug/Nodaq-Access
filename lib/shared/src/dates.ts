/**
 * Business-date formatting.
 *
 * A BUSINESS DATE (a calendar day — an invoice date, a period boundary, a due
 * date) must always be formatted from LOCAL components. `toISOString()` first
 * converts to UTC, which silently shifts the calendar day in any timezone
 * offset from UTC (e.g. Europe/Paris) — an invoice dated 2026-09-01 read back
 * from Postgres and formatted with `toISOString()` then sliced to 10 chars
 * renders as "2026-08-31" in Paris.
 *
 * `toISOString()` is only correct for an INSTANT (a point in time — a
 * `timestamptz` comparison, an audit log timestamp). Never use it to render a
 * calendar day a user typed, chose, or will read back.
 */

/**
 * Format a Date as "YYYY-MM-DD" using its LOCAL components.
 * Never derive a business date from `toISOString()` (sliced or split on
 * "T") — see module doc above.
 */
export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Monday and Sunday of the week containing `d`, as business dates.
 *
 * Built from LOCAL components throughout — the week an artisan confirms on
 * Friday evening is their week, not UTC's. A boundary derived via toISOString
 * would shift by a day near midnight and file Monday's hours under the previous
 * week. ISO convention: the week starts on Monday.
 */
export function bornesSemaine(d: Date): { debut: string; fin: string } {
  const jour = d.getDay(); // 0 = dimanche
  const versLundi = jour === 0 ? -6 : 1 - jour;

  const lundi = new Date(d);
  lundi.setDate(d.getDate() + versLundi);

  const dimanche = new Date(lundi);
  dimanche.setDate(lundi.getDate() + 6);

  return { debut: toDateString(lundi), fin: toDateString(dimanche) };
}
