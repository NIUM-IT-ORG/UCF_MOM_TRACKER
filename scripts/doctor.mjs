/**
 * Finds out what is actually wrong, in one command.
 *
 * Written after four rounds of "something went wrong" screenshots. Each round
 * cost an afternoon and told us one fact. This asks every question at once and
 * prints the answers, so a single paste is enough to work from.
 *
 * It checks, in order of how often each one is the culprit:
 *
 *   1. migrations on disk vs migrations recorded in the database
 *   2. every Prisma field against every real column   (the P2022 class)
 *   3. the generated client vs the schema it was generated from
 *   4. the API: is it up, and does each write actually work
 *
 * Step 4 signs in as a seeded officer and performs the four writes that have
 * given trouble — attendance, minutes, a document, an action — reporting the
 * real error for each rather than the generic one the browser shows.
 *
 * It puts back everything it touches. What is already recorded is re-saved
 * unchanged, and anything it adds in order to try a write is removed again;
 * only the audit trail keeps a record, because that is append-only by design.
 *
 *   pnpm doctor
 */
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compare, parseSchema, readColumns } from './lib/schema-check.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const { Client } = require('pg');

const API = `http://localhost:${process.env.PORT ?? 4000}/api/v1`;
const PASSWORD = process.env.DOCTOR_PASSWORD ?? 'ucf-demo-2026';

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  failures += 1;
  console.log(`  FAIL  ${m}`);
};
const note = (m) => console.log(`        ${m}`);
const heading = (m) => console.log(`\n${m}`);

// ── 1 · migrations ────────────────────────────────────────────────────
async function checkMigrations(db) {
  heading('Migrations');
  const onDisk = readdirSync(join(root, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let applied = [];
  try {
    const { rows } = await db.query(
      'select migration_name from _prisma_migrations where finished_at is not null',
    );
    applied = rows.map((r) => r.migration_name);
  } catch {
    bad('no _prisma_migrations table — the database has never been migrated');
    note('run: pnpm db:apply');
    return;
  }

  const missing = onDisk.filter((m) => !applied.includes(m));
  if (missing.length === 0) {
    ok(`all ${onDisk.length} migration(s) applied`);
  } else {
    bad(`${missing.length} migration(s) on disk have not been applied:`);
    for (const m of missing) note(`- ${m}`);
    note('run: pnpm db:apply');
    note('This is the usual cause when a save fails but reads work: the code');
    note('is newer than the database it is talking to.');
  }
}

// ── 2 · schema vs database ────────────────────────────────────────────
async function checkSchema(db) {
  heading('Schema and database');
  // The same comparison `pnpm assert:schema` fails a build on, so a machine
  // and a build never disagree about what a mismatch is.
  const models = parseSchema(readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8'));
  const { checked, problems } = compare(models, await readColumns(db));

  if (problems.length === 0) {
    ok(`${checked} field(s) all map to real columns`);
    return;
  }
  bad(`${problems.length} field(s) name a column that does not exist:`);
  for (const p of problems) note(`- ${p}`);
  note('Prisma fails with P2022 the first time each is read or written.');
}

// ── 3 · the generated client ──────────────────────────────────────────
function checkGeneratedClient() {
  heading('Generated Prisma client');
  // Windows checkouts and pnpm's store disagree about line endings, and an
  // editor may leave a trailing newline. Neither changes what was generated,
  // so compare the schema's meaning, not its bytes.
  const normalise = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  const schema = normalise(readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8'));

  let installed = [];
  try {
    installed = readdirSync(join(root, 'node_modules', '.pnpm'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('@prisma+client@'))
      .map((d) =>
        join(root, 'node_modules', '.pnpm', d.name, 'node_modules', '.prisma', 'client', 'schema.prisma'),
      );
  } catch {
    // installed with npm rather than pnpm; the path below is the only one
  }

  const found = [join(root, 'node_modules', '.prisma', 'client', 'schema.prisma'), ...installed].find(
    (p) => existsSync(p),
  );
  if (!found) {
    bad('no generated client found — run: pnpm exec prisma generate');
    return;
  }
  if (normalise(readFileSync(found, 'utf8')) === schema) {
    ok('generated from the current schema');
  } else {
    bad('generated from an OLDER schema than prisma/schema.prisma');
    note('run: pnpm exec prisma generate');
    note('Until you do, Prisma reads and writes the columns the OLD schema named.');
  }
}

// ── 4 · the API, exercised for real ───────────────────────────────────
async function checkApi(db) {
  heading('API');
  try {
    const r = await fetch(`${API}/health`);
    if (!r.ok) throw new Error(String(r.status));
    ok(`reachable at ${API}`);
  } catch {
    bad(`not reachable at ${API} — start it with RUN.bat, then run this again`);
    return;
  }

  // Sign in as a coordinator: the designation that does all four writes.
  const who = await db.query(
    `select u.email from users u join designations d on d.id = u.designation_id
     where u.account_state = 'ACTIVE' and 'record_minutes' = any(d.caps)
       and 'mark_attendance' = any(d.caps) order by u.email limit 1`,
  );
  const email = who.rows[0]?.email;
  if (!email) {
    bad('no active officer holds both record_minutes and mark_attendance');
    return;
  }

  const jar = [];
  const call = async (path, init = {}) => {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', cookie: jar.join('; '), ...(init.headers ?? {}) },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) jar.push(c.split(';')[0]);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const challenge = login.body?.data;
  if (!challenge?.challengeId || !challenge.devOtp) {
    bad(`could not sign in as ${email} — ${describe(login)}`);
    note('If the password was changed, set DOCTOR_PASSWORD and run again.');
    return;
  }
  const verified = await call('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ challengeId: challenge.challengeId, otp: challenge.devOtp }),
  });
  if (verified.status !== 200) {
    bad(`could not complete sign-in — ${describe(verified)}`);
    return;
  }
  ok(`signed in as ${email}`);

  // A meeting that has been held, so attendance and minutes are legal on it.
  // MINUTED first: attendance there has already been taken, so re-saving it
  // moves no meeting to a new stage.
  const held = await db.query(
    `select id, code, stage from meetings where stage in ('MINUTED','HELD')
     order by case stage when 'MINUTED' then 0 else 1 end, meeting_date desc limit 1`,
  );
  const meeting = held.rows[0];
  if (!meeting) {
    note('no meeting is at HELD or MINUTED, so the three writes cannot be tried');
    note('hold a meeting first, then run this again');
    return;
  }
  note(`using meeting ${meeting.code}`);
  note('These writes go through the real API and are then undone. What was');
  note('already recorded is re-saved unchanged; anything new is removed.');

  // 1 · attendance — re-save what is already on the sheet.
  const invitees = await db.query(
    'select user_id, attendance from meeting_invitees where meeting_id = $1 order by user_id',
    [meeting.id],
  );
  if (invitees.rows.length === 0) {
    note('nobody is invited to that meeting, so attendance cannot be tried');
  } else {
    const already = invitees.rows.filter((r) => r.attendance);
    const probing = already.length === 0;
    const marks = probing
      ? { [invitees.rows[0].user_id]: 'PRESENT' }
      : Object.fromEntries(already.map((r) => [r.user_id, r.attendance]));

    const att = await call(`/meetings/${meeting.id}/attendance`, {
      method: 'PUT',
      body: JSON.stringify({ marks }),
    });
    if (att.status === 200) ok('attendance saves');
    else bad(`attendance does not save — ${describe(att)}`);

    if (probing) {
      await db.query(
        'update meeting_invitees set attendance = null where meeting_id = $1 and user_id = $2',
        [meeting.id, invitees.rows[0].user_id],
      );
      // setAttendance may have advanced the meeting; put the stage back too.
      await db.query('update meetings set stage = $2::"MeetingStage" where id = $1', [
        meeting.id,
        meeting.stage,
      ]);
    }
  }

  // 2 · minutes — save the existing text back, byte for byte.
  const existing = await db.query('select body_html from minutes where meeting_id = $1', [
    meeting.id,
  ]);
  const hadMinutes = existing.rows.length > 0;
  const min = await call(`/meetings/${meeting.id}/minutes`, {
    method: 'POST',
    body: JSON.stringify({
      bodyHtml: hadMinutes ? existing.rows[0].body_html : '<p>Written by pnpm doctor.</p>',
    }),
  });
  if (min.status === 200 || min.status === 201) ok('minutes save');
  else bad(`minutes do not save — ${describe(min)}`);
  if (!hadMinutes) await db.query('delete from minutes where meeting_id = $1', [meeting.id]);

  // 3 · a document, all three steps, then taken off the record again.
  const reserved = await call('/files', {
    method: 'POST',
    body: JSON.stringify({ fileName: 'doctor.txt', mimeType: 'text/plain', sizeBytes: 11 }),
  });
  if (reserved.status !== 201 && reserved.status !== 200) {
    bad(`reserving a file fails — ${describe(reserved)}`);
    return;
  }
  const fileId = reserved.body.data.fileId;
  const put = await fetch(`${API}/files/${fileId}/content`, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain', cookie: jar.join('; ') },
    body: 'doctor test',
  });
  if (!put.ok) {
    bad(`uploading the bytes fails — HTTP ${put.status}`);
  } else {
    const doc = await call(`/meetings/${meeting.id}/documents`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Doctor test paper', type: 'CORRESPONDENCE', fileId }),
    });
    if (doc.status === 200 || doc.status === 201) ok('documents save');
    else bad(`documents do not save — ${describe(doc)}`);
    await db.query('delete from documents where file_id = $1', [fileId]);
  }
  await db.query('delete from stored_files where id = $1', [fileId]);

  // 4 · raising an action — the write that failed first, and the one that
  // goes through the most of Prisma. Inert either way, and removed after.
  const project = await db.query(
    'select project_id from meeting_projects where meeting_id = $1 limit 1',
    [meeting.id],
  );
  if (project.rows.length === 0) {
    note('that meeting is against no project, so raising an action cannot be tried');
    return;
  }
  const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const me = await db.query('select id from users where email = $1', [email]);
  const item = await call('/items', {
    method: 'POST',
    body: JSON.stringify({
      type: 'ACTION',
      meetingId: meeting.id,
      projectId: project.rows[0].project_id,
      description: 'Raised by pnpm doctor to prove the write works. Removed immediately.',
      raisedById: me.rows[0].id,
      ownerIds: [me.rows[0].id],
      dueDate: due,
    }),
  });
  if (item.status === 200 || item.status === 201) {
    ok('actions save');
    await db.query('delete from items where id = $1', [item.body.data.id]);
  } else {
    bad(`actions do not save — ${describe(item)}`);
  }
}

function describe({ status, body }) {
  const e = body?.error;
  if (!e) return `HTTP ${status}`;
  return `HTTP ${status} ${e.code}: ${e.message}${e.fault ? ` [${e.fault}]` : ''}`;
}

// ── run ───────────────────────────────────────────────────────────────
async function main() {
  console.log('\nMoM_Tracker · checking what is wrong');

  if (!process.env.DATABASE_URL) {
    console.error('\nDATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL.replace(/\?.*$/, '') });
  try {
    await db.connect();
    ok('database reachable');
  } catch (err) {
    bad(`cannot reach the database — ${err instanceof Error ? err.message : err}`);
    console.log('\nStart it with RUN.bat (or pnpm db:local) and try again.\n');
    process.exit(1);
  }

  await checkMigrations(db);
  await checkSchema(db);
  checkGeneratedClient();
  await checkApi(db);
  await db.end();

  console.log(
    failures === 0
      ? '\nNothing wrong found. If something still fails, the message on screen\nnow names the cause and carries a reference.\n'
      : `\n${failures} problem(s) above. Fix them top to bottom — an early one\noften explains the later ones.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
