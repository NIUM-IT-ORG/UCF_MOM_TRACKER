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

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const { Client } = require('pg');

/** Scalar Prisma types. Anything else is a relation or an enum. */
const SCALARS = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
]);

function parseSchema(text) {
  const models = [];
  const enums = new Set();

  for (const m of text.matchAll(/^enum\s+(\w+)\s*\{/gm)) enums.add(m[1]);

  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (const match of text.matchAll(modelRe)) {
    const [, name, body] = match;
    const lines = body
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter(Boolean);

    let table = null;
    const fields = [];

    for (const line of lines) {
      if (line.startsWith('///')) continue;
      if (line.startsWith('@@')) {
        const t = /@@map\("([^"]+)"\)/.exec(line);
        if (t) table = t[1];
        continue;
      }
      const field = /^(\w+)\s+(\w+)(\[\])?(\?)?/.exec(line);
      if (!field) continue;

      const [, fieldName, fieldType, list] = field;
      // A list is always a relation; a relation attribute says so outright.
      if (list || line.includes('@relation')) continue;

      const mapped = /@map\("([^"]+)"\)/.exec(line);
      fields.push({
        field: fieldName,
        type: fieldType,
        column: mapped ? mapped[1] : fieldName,
        mapped: Boolean(mapped),
        scalarOrEnum: SCALARS.has(fieldType) || enums.has(fieldType),
      });
    }

    models.push({ name, table: table ?? name, fields: fields.filter((f) => f.scalarOrEnum) });
  }

  return models;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');
  const models = parseSchema(schema);

  const client = new Client({ connectionString: url.replace(/\?.*$/, '') });
  await client.connect();

  const { rows } = await client.query(
    `select table_name, column_name from information_schema.columns
     where table_schema = current_schema()`,
  );
  await client.end();

  const byTable = new Map();
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Set());
    byTable.get(r.table_name).add(r.column_name);
  }

  const problems = [];
  let checked = 0;

  for (const model of models) {
    const columns = byTable.get(model.table);
    if (!columns) {
      problems.push(`model ${model.name}: no table "${model.table}" in the database`);
      continue;
    }
    for (const f of model.fields) {
      checked += 1;
      if (columns.has(f.column)) continue;

      // The likeliest cause by far: a missing @map on a camelCase field whose
      // column is snake_case. Say so, with the line to add.
      const snake = f.field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      const hint = columns.has(snake)
        ? `the column is "${snake}" — add @map("${snake}")`
        : `no column "${f.column}" and no obvious match`;
      problems.push(`${model.name}.${f.field} → ${model.table}."${f.column}": ${hint}`);
    }
  }

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
