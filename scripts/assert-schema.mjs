/**
 * Every Prisma field must name a column that actually exists.
 *
 * This exists because of a defect that survived four phases. `Item.actionStatus`
 * had no `@map("action_status")`, so Prisma asked PostgreSQL for a column called
 * "actionStatus" and got:
 *
 *   P2022: The column `actionStatus` does not exist in the current database.
 *
 * Nothing caught it earlier because nothing had *written* that column through
 * Prisma yet — the seed uses raw SQL, and the tests use an in-memory fake. The
 * first person to raise an action in a real meeting found it instead, which is
 * the worst possible place to find it.
 *
 * TypeScript cannot catch this: `actionStatus` is a perfectly valid field name.
 * Only a comparison against the real database can, so that is what this does —
 * for every model and every field, not just the one that broke.
 *
 *   pnpm assert:schema
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compare, parseSchema, readColumns } from './lib/schema-check.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const models = parseSchema(readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8'));

  const client = new Client({ connectionString: url.replace(/\?.*$/, '') });
  await client.connect();
  const byTable = await readColumns(client);
  await client.end();

  const { checked, problems } = compare(models, byTable);

  if (problems.length > 0) {
    console.error(`\nSchema and database disagree on ${problems.length} field(s):\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      '\nPrisma will ask PostgreSQL for a column that does not exist and fail\n' +
        'with P2022 the first time that field is read or written.\n',
    );
    process.exit(1);
  }

  console.log(
    `\nEvery Prisma field maps to a real column — ${checked} field(s) across ${models.length} model(s).\n`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
