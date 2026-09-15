/**
 * Is this database carrying somebody's real work?
 *
 * The seed is a reset: it TRUNCATEs every table before loading the prototype's
 * dataset. That is right for a fresh checkout and catastrophic on a machine
 * somebody has been using — and `SETUP.bat` runs the seed, so "run setup again"
 * was one keystroke away from erasing a week of minutes. It has to be safe to
 * say.
 *
 * Every seeded row's id starts with `seed_`; everything the application creates
 * gets a cuid. So anything without that prefix was put there by a person, and
 * that is the whole test.
 */
import type { Client } from 'pg';

/** Tables where a row can only exist because somebody entered it. */
const TABLES = [
  'meetings',
  'items',
  'minutes',
  'documents',
  'moms',
  'projects',
  'users',
] as const;

export interface OwnWork {
  table: string;
  rows: number;
}

export async function ownWork(db: Client): Promise<OwnWork[]> {
  const found: OwnWork[] = [];
  for (const table of TABLES) {
    try {
      const { rows } = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "${table}" WHERE id NOT LIKE 'seed\\_%'`,
      );
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) found.push({ table, rows: n });
    } catch {
      // The table does not exist yet — a database this empty is not in use.
    }
  }
  return found;
}

export function describeOwnWork(found: OwnWork[]): string {
  return found.map((f) => `${f.rows} ${f.table}`).join(', ');
}
