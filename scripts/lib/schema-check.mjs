/**
 * Prisma's schema, read as data, and compared against the real columns.
 *
 * Two scripts need this: `pnpm assert:schema`, which fails a build, and
 * `pnpm doctor`, which explains a running machine. They must never disagree
 * about what counts as a mismatch, so there is one implementation and both
 * call it.
 *
 * Why it exists at all: `Item.actionStatus` had no `@map("action_status")`,
 * so Prisma asked PostgreSQL for a column called "actionStatus" and got
 * P2022. TypeScript cannot catch that — the field name is perfectly valid —
 * and no test caught it either, because the seed writes raw SQL. Only a
 * comparison against a real database finds it.
 */

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

/** @returns {{name: string, table: string, fields: {field: string, type: string, column: string, mapped: boolean}[]}[]} */
export function parseSchema(text) {
  const models = [];
  const enums = new Set();

  for (const m of text.matchAll(/^enum\s+(\w+)\s*\{/gm)) enums.add(m[1]);

  for (const match of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
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
      if (!SCALARS.has(fieldType) && !enums.has(fieldType)) continue;

      const mapped = /@map\("([^"]+)"\)/.exec(line);
      fields.push({
        field: fieldName,
        type: fieldType,
        column: mapped ? mapped[1] : fieldName,
        mapped: Boolean(mapped),
      });
    }

    models.push({ name, table: table ?? name, fields });
  }

  return models;
}

/** Every column in the current schema, as table name → set of column names. */
export async function readColumns(client) {
  const { rows } = await client.query(
    `select table_name, column_name from information_schema.columns
     where table_schema = current_schema()`,
  );
  const byTable = new Map();
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Set());
    byTable.get(r.table_name).add(r.column_name);
  }
  return byTable;
}

/**
 * @returns {{checked: number, models: number, problems: string[]}}
 * Each problem is one sentence naming the fix, because whoever reads it is
 * looking at a failure, not at this file.
 */
export function compare(models, byTable) {
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

  return { checked, models: models.length, problems };
}
