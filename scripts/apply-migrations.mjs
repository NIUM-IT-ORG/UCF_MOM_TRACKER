/**
 * Applies `prisma/migrations` directly, without Prisma's schema engine.
 *
 * `prisma migrate deploy` is the normal route and `pnpm db:deploy` is what you
 * should run. This is the fallback for one specific situation: Prisma downloads
 * its engine binaries from binaries.prisma.sh at install time, and some
 * corporate networks block that host. Without the engine, `migrate deploy`
 * cannot run at all — but the migrations themselves are plain SQL, and nothing
 * about applying them needs a Rust binary.
 *
 *   pnpm db:apply
 *
 * It writes the same `_prisma_migrations` bookkeeping Prisma writes, with the
 * same checksum, so a later `prisma migrate deploy` or `migrate dev` sees the
 * migrations as already applied rather than trying to run them twice.
 *
 * Note this does not remove the need for the engine to RUN the API — the
 * Prisma client needs the query engine. It gets you a correct database while
 * you sort the network out.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(dirname(here), 'prisma', 'migrations');

const BOOKKEEPING = `
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
  )
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');

  const folders = readdirSync(migrationsDir)
    .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
    .sort(); // timestamp-prefixed, so lexical order is chronological

  if (folders.length === 0) throw new Error('No migrations found.');

  const db = new Client({ connectionString: url });
  await db.connect();

  try {
    await db.query(BOOKKEEPING);

    const applied = await db.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
    );
    const done = new Set(applied.rows.map((r) => r.migration_name));

    let ran = 0;
    for (const name of folders) {
      if (done.has(name)) {
        console.log(`  = ${name} (already applied)`);
        continue;
      }

      const file = join(migrationsDir, name, 'migration.sql');
      const sql = readFileSync(file, 'utf8');
      const checksum = createHash('sha256').update(readFileSync(file)).digest('hex');

      // One transaction per migration: it either lands whole or not at all.
      await db.query('BEGIN');
      try {
        await db.query(sql);
        await db.query(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
           VALUES ($1, $2, $3, now(), now(), 1)`,
          [randomUUID(), checksum, name],
        );
        await db.query('COMMIT');
        console.log(`  + ${name}`);
        ran += 1;
      } catch (err) {
        await db.query('ROLLBACK');
        throw new Error(
          `${name} failed and was rolled back:\n    ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    console.log(
      ran === 0
        ? '\nThe database is already up to date.'
        : `\nApplied ${ran} migration${ran === 1 ? '' : 's'}.`,
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
