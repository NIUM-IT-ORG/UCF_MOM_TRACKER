/**
 * Runs `prisma generate`, and survives the Windows file lock.
 *
 * Prisma writes a native query engine into node_modules/.prisma/client. On
 * Windows a DLL that is loaded by a running process cannot be renamed, so if
 * the API is still running - or Defender happens to be scanning the file at
 * that moment - generate fails with:
 *
 *   EPERM: operation not permitted, rename '...query_engine-windows.dll.node'
 *
 * This runs as `postinstall`, so that error also fails `pnpm install`, and the
 * message says nothing about the actual cause. Here it is retried a couple of
 * times, and then reported in terms of the thing the person has to do.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The Prisma CLI's own entry point, run with this Node.
 *
 * Not the `prisma` command: that is a shim in node_modules/.bin which is only
 * on PATH inside a package script, and this file is also called directly.
 * Resolving the module means it works either way, and on every platform.
 */
function prismaCli() {
  const require = createRequire(join(root, 'package.json'));
  const pkg = require('prisma/package.json');
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma;
  return require.resolve(`prisma/${bin}`);
}
const ATTEMPTS = 3;
const PAUSE_MS = 2500;

function run(env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [prismaCli(), 'generate'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('error', (err) => resolve({ code: 1, out: String(err) }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate the TypeScript client without downloading a native engine.
 *
 * `prisma generate` fetches its query and schema engines from
 * binaries.prisma.sh on first run. Behind a proxy that does not allow that host
 * it fails with a bare "403 Forbidden", and since this runs as `postinstall`
 * the whole install fails with an error that mentions nothing you can act on.
 *
 * The generated client is TypeScript — the types and the query builder — and
 * producing it needs no native engine at all; the engine is a *runtime*
 * dependency, loaded when the API opens a connection. Pointing the two engine
 * variables at an existing file is how Prisma is told "this one is already
 * here, do not download it", which skips the fetch and emits the client.
 *
 * So: try the normal path first, because on a machine with open network it
 * also places the runtime engine. Only if that fails on the download do we fall
 * back to types-only, and say plainly what that does and does not give you.
 */
function typesOnlyEnv() {
  const marker = join(root, 'node_modules', '.prisma-engine-placeholder');
  writeFileSync(marker, 'placeholder - see scripts/prisma-generate.mjs\n');
  return {
    ...process.env,
    PRISMA_SCHEMA_ENGINE_BINARY: marker,
    PRISMA_QUERY_ENGINE_LIBRARY: marker,
    PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: '1',
  };
}

const isDownloadFailure = (out) =>
  /binaries\.prisma\.sh|Failed to fetch (the engine|sha256)/i.test(out);

let last = { code: 1, out: '' };
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  last = await run();
  if (last.code === 0) {
    const line = last.out.split('\n').find((l) => /Generated Prisma Client/i.test(l));
    console.log(`   ${(line ?? 'Prisma client generated.').trim()}`);
    process.exit(0);
  }

  const locked = /EPERM|EBUSY|operation not permitted/i.test(last.out);
  if (!locked || attempt === ATTEMPTS) break;

  console.log(
    `   The Prisma engine file is locked. Waiting ${PAUSE_MS / 1000}s and trying again ` +
      `(${attempt} of ${ATTEMPTS - 1})...`,
  );
  await sleep(PAUSE_MS);
}

// The engine host is unreachable. Generate the client types anyway, so the
// workspace compiles and the tests run; the API will say so when it tries to
// open a connection, which is a far clearer place to find out.
if (isDownloadFailure(last.out)) {
  const typesOnly = await run(typesOnlyEnv());
  if (typesOnly.code === 0) {
    console.log(
      '   Prisma client types generated. The native query engine could not be\n' +
        '   downloaded (binaries.prisma.sh was unreachable), so the API cannot\n' +
        '   open a database connection until it is. Building and testing work.',
    );
    process.exit(0);
  }
  last = typesOnly;
}

console.error(last.out.trim());

if (/EPERM|EBUSY|operation not permitted/i.test(last.out)) {
  console.error(`
   ---------------------------------------------------------------
   Prisma could not replace its query engine because the file is in
   use. On Windows that means one of these:

     1. MoM_Tracker is still running. Close the RUN.bat window
        (Ctrl+C in it), then run SETUP.bat again. This is nearly
        always the reason.

     2. An antivirus scanner has the file open for a moment. Waiting
        a few seconds and running SETUP.bat again is usually enough.

     3. A previous run left a stale file. Delete this folder and run
        SETUP.bat again - it will be recreated:
          node_modules\\.prisma
   ---------------------------------------------------------------`);
} else if (!existsSync(join(root, 'node_modules', '.prisma', 'client'))) {
  console.error(`
   Prisma could not generate its client. It downloads an engine binary
   from binaries.prisma.sh on first run; if a proxy blocks that host,
   set HTTPS_PROXY and try again. The database itself can still be set
   up without it - see SETUP-WINDOWS.md.`);
}

process.exit(last.code);
