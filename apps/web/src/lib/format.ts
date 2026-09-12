/**
 * How things are written down, in one place.
 *
 * These are rules from docs/07-UI-SPEC.md, not preferences: dates as
 * `27 Aug 2026` and never ISO, money as `₹ 120.00 cr`. Scattering the
 * formatting is how half a screen ends up in one style and half in another.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `2026-08-27` → `27 Aug 2026`. Never `27/08/2026`, which is ambiguous. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `"120.45"` → `₹ 120.45 cr`. The value stays a string all the way here. */
export function formatCrore(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const [whole = '0', decimals = '00'] = value.split('.');
  const grouped = Number(whole).toLocaleString('en-IN');
  return `₹ ${grouped}.${decimals.padEnd(2, '0')} cr`;
}

/** Bytes as something a person reads: `1.4 MB`. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** How much of the sanctioned debt has been drawn, as a percentage. */
export function drawnPercent(sanctioned: string, drawn: string): number {
  const s = Number(sanctioned);
  if (!s) return 0;
  return Math.round((Number(drawn) / s) * 100);
}
