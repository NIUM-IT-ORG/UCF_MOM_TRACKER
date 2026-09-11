/**
 * A PostgreSQL that needs no installer and no administrator rights.
 *
 * The binaries come from the npm registry into `var/localdb`, the cluster
 * lives in `var/pgdata`, and it listens on 5433 so it can never collide with
 * a real PostgreSQL on 5432. Nothing is installed system-wide, no Windows
 * service is created, and deleting `var/` undoes all of it.
 *
 * This is a development convenience, not a deployment story. A server runs a
 * properly installed PostgreSQL; see docs/10-DEPLOYMENT.md. Setup prefers an
 * installed PostgreSQL whenever it finds one and only falls back to this.
 *
 *   node scripts/local-db.mjs start          run it in the foreground
 *   node scripts/local-db.mjs init           create the cluster and database
 *   node scripts/local-db.mjs run <scripts>  start, run `pnpm <script>` for
 *                                            each name in turn, then stop
 *
 * It cannot be started and left behind: embedded-postgres runs the server as
 * a child process and shuts it down when this process exits. That is why
 * `pnpm dev:all` runs it alongside the API and the web application rather
 * than starting it once and forgetting about it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const varDir = join(root, 'var');
const pkgDir = join(varDir, 'localdb');
const dataDir = join(varDir, 'pgdata');

export const LOCAL_DB = {
  host: '127.0.0.1',
  port: 5433,
  user: 'ucf',
  password: 'ucf_dev_only',
  database: 'mom_tracker',
};
export const LOCAL_DB_URL =
  `postgresql://${LOCAL_DB.user}:${LOCAL_DB.password}` +
  `@${LOCAL_DB.host}:${LOCAL_DB.port}/${LOCAL_DB.database}?schema=public`;

function say(m) {
  console.log(`   ${m}`);
}

/** Downloads the PostgreSQL binaries on first use, into var/ where they are ignored. */
function ensurePackage() {
  const require = createRequire(join(pkgDir, 'noop.js'));
  try {
    return require.resolve('embedded-postgres');
  } catch {
    // not installed yet
  }

  say('Fetching PostgreSQL binaries from the npm registry (about 110 MB, once).');
  mkdirSync(pkgDir, { recursive: true });
  const manifest = join(pkgDir, 'package.json');
  if (!existsSync(manifest)) {
    writeFileSync(
      manifest,
      JSON.stringify({ name: 'mom-localdb', private: true, version: '1.0.0' }, null, 2),
    );
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', 'embedded-postgres', '--no-audit', '--no-fund'], {
    cwd: pkgDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    throw new Error(
      'Could not download the PostgreSQL binaries. If a proxy is blocking the npm\n' +
        '   registry, install PostgreSQL normally instead - see SETUP-WINDOWS.md.',
    );
  }
  return require.resolve('embedded-postgres');
}

async function open() {
  const entry = ensurePackage();
  const mod = await import(`file://${entry}`);
  const EmbeddedPostgres = mod.default ?? mod;

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: LOCAL_DB.user,
    password: LOCAL_DB.password,
    port: LOCAL_DB.port,
    persistent: true,
  });

  if (!existsSync(dataDir)) {
    say('Creating the database cluster in var/pgdata.');
    await pg.initialise();
  }

  await pg.start();

  // Ask before creating, rather than creating and catching the failure.
  // embedded-postgres opens a client for createDatabase and does not close it
  // when the statement errors; the dangling client then emits an unhandled
  // error that takes this process - and with it the server - straight down.
  if (!(await databaseExists())) {
    await pg.createDatabase(LOCAL_DB.database);
    say(`Created the ${LOCAL_DB.database} database.`);
  }

  return pg;
}

async function databaseExists() {
  const { Client } = await import('pg');
  const admin = new Client({
    host: LOCAL_DB.host,
    port: LOCAL_DB.port,
    user: LOCAL_DB.user,
    password: LOCAL_DB.password,
    database: 'postgres',
  });
  await admin.connect();
  try {
    const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      LOCAL_DB.database,
    ]);
    return (r.rowCount ?? 0) > 0;
  } finally {
    await admin.end();
  }
}

/**
 * Runs `pnpm <name>` for each name, in order, stopping at the first failure.
 *
 * Asynchronous on purpose. spawnSync blocks the event loop, and the database
 * server is a child of this very process - block the loop for the length of a
 * migration and the server's own plumbing starts dropping connections.
 */
async function runScripts(names) {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  for (const name of names) {
    console.log(`\n   > pnpm ${name}`);
    const code = await new Promise((resolve) => {
      const child = spawn(pnpm, [name], {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? LOCAL_DB_URL },
      });
      child.on('error', (err) => {
        console.error(`   Could not run "pnpm ${name}": ${err.message}`);
        resolve(1);
      });
      child.on('close', (c) => resolve(c ?? 1));
    });
    if (code !== 0) return code;
  }
  return 0;
}

// Only act when run directly. write-env.mjs imports this file for the URL,
// and an import that starts a database server would be a nasty surprise.
const isEntry =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

const command = process.argv[2] ?? 'start';

if (!isEntry) {
  // imported for LOCAL_DB / LOCAL_DB_URL only
} else if (command === 'init') {
  const pg = await open();
  say(`Ready on port ${LOCAL_DB.port}.`);
  await pg.stop();
  say('Stopped. Start it with: pnpm db:local');
} else if (command === 'run') {
  const names = process.argv.slice(3);
  if (names.length === 0) throw new Error('usage: local-db.mjs run <script> [script...]');
  const pg = await open();
  say(`Running on port ${LOCAL_DB.port}.`);
  let code = 0;
  try {
    code = await runScripts(names);
  } finally {
    await pg.stop();
    console.log('\n   Database stopped.');
  }
  process.exit(code);
} else if (command === 'start') {
  const pg = await open();
  console.log(`   PostgreSQL is listening on ${LOCAL_DB.host}:${LOCAL_DB.port}`);
  console.log('   Ctrl+C stops it.');

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\n   Stopping the database...');
    try {
      await pg.stop();
    } catch {
      // already gone
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Hold the process open. The server is a child of this one and goes down
  // with it, which is deliberate: no stray database left running after a
  // session, and nothing to remember to shut down.
  await new Promise(() => {});
} else {
  console.error(`Unknown command "${command}". Use start, init or run.`);
  process.exit(1);
}
