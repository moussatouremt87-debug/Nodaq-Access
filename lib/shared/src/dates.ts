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
