/**
 * Guards the Windows scripts against the encoding trap that broke them once.
 *
 * Windows PowerShell 5.1 decodes a BOM-less file as the system ANSI codepage.
 * A UTF-8 file full of box-drawing characters then becomes mojibake, and some
 * of that mojibake contains curly quotes (U+201C / U+201D) — which PowerShell
 * accepts as real string delimiters. The rest of the file is swallowed into a
 * string and the parse fails far away from the actual cause, with a message
 * about a missing brace.
 *
 * So: .ps1 files must be ASCII-only, CRLF, and carry a UTF-8 BOM. .bat files
 * must be ASCII-only and CRLF (cmd.exe does not want a BOM).
 *
 * Migration SQL is checked too, for a different reason with the same shape: a
 * cluster created on an English-Windows machine defaults to WIN1252, and a
 * box-drawing character in a comment is then unsendable - "no equivalent in
 * encoding WIN1252". Development clusters are forced to UTF8 now, but the
 * migrations should not depend on that.
 *
 *   pnpm check:scripts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const problems = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (/\.(ps1|bat|cmd)$/i.test(entry)) {
      check(full);
    } else if (/\.sql$/i.test(entry)) {
      checkSql(full);
    }
  }
}

function check(file) {
  const rel = relative(root, file);
  const buf = readFileSync(file);
  const isPs1 = /\.ps1$/i.test(file);

  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = hasBom ? buf.subarray(3) : buf;

  if (isPs1 && !hasBom) {
    problems.push(`${rel}: no UTF-8 BOM — PowerShell 5.1 will decode it as ANSI`);
  }
  if (!isPs1 && hasBom) {
    problems.push(`${rel}: has a UTF-8 BOM — cmd.exe echoes it as stray characters`);
  }

  // ASCII only. Report the first offender with its line, so the fix is obvious.
  for (let i = 0; i < body.length; i += 1) {
    const byte = body[i];
    if (byte !== undefined && byte > 0x7f) {
      const line = body.subarray(0, i).toString('latin1').split('\n').length;
      problems.push(
        `${rel}:${line}: non-ASCII byte 0x${byte.toString(16)} — use plain ASCII here`,
      );
      break;
    }
  }

  // CRLF. A lone LF is tolerated by both interpreters but confuses editors
  // and diffs on Windows, and .bat files genuinely misbehave without it.
  const text = body.toString('latin1');
  const lf = (text.match(/\n/g) ?? []).length;
  const crlf = (text.match(/\r\n/g) ?? []).length;
  if (lf > 0 && crlf !== lf) {
    problems.push(`${rel}: ${lf - crlf} line(s) end in LF rather than CRLF`);
  }
}

/** Migration SQL must be ASCII, so it applies to a cluster of any encoding. */
function checkSql(file) {
  const rel = relative(root, file);
  const buf = readFileSync(file);
  for (let i = 0; i < buf.length; i += 1) {
    const byte = buf[i];
    if (byte !== undefined && byte > 0x7f) {
      const line = buf.subarray(0, i).toString('latin1').split('\n').length;
      problems.push(
        `${rel}:${line}: non-ASCII byte 0x${byte.toString(16)} - SQL must be ASCII, ` +
          'or it cannot be applied to a WIN1252 cluster',
      );
      return;
    }
  }
}

walk(root);

if (problems.length > 0) {
  console.error('Windows script checks failed:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nSee the note at the top of scripts/windows/install.ps1.');
  process.exit(1);
}
console.log('Scripts are ASCII/CRLF/BOM-correct, and the SQL is ASCII.');
