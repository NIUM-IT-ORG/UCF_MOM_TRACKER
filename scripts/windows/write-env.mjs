/**
 * Writes .env from .env.example, with real generated secrets.
 *
 * Done in Node rather than in the batch file because generating a secret and
 * doing a safe search-and-replace are both miserable in cmd, and Node is
 * already a hard requirement.
 *
 *   node scripts/windows/write-env.mjs [databaseUrl]
 *   node scripts/windows/write-env.mjs --local   (use the bundled database)
 *
 * Never overwrites an existing .env - an existing one is the developer's, and
 * silently replacing it would throw away whatever they had configured.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

if (existsSync(envPath)) {
  console.log('   .env already exists - leaving it exactly as it is');
  process.exit(0);
}

if (!existsSync(examplePath)) {
  console.error('   .env.example is missing. Is this the repository root?');
  process.exit(1);
}

const secret = () => randomBytes(48).toString('base64url');

let text = readFileSync(examplePath, 'utf8')
  .replace('replace_me_with_a_long_random_string', secret())
  .replace('replace_me_with_a_different_long_random_string', secret());

let databaseUrl = process.argv[2];
if (databaseUrl === '--local') {
  // One definition of the bundled database's address, in local-db.mjs.
  ({ LOCAL_DB_URL: databaseUrl } = await import('../local-db.mjs'));
}
if (databaseUrl) {
  text = text.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${databaseUrl}`);
}

// No BOM. A byte-order mark here would make dotenv read the first key
// as a name with an invisible character in front of it.
writeFileSync(envPath, text, { encoding: 'utf8' });
console.log('   .env written, with freshly generated secrets');
