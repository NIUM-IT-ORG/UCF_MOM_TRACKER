import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { documentInput, reserveFileDto, ulbDto, createProjectDto } from '@mom/shared';

/**
 * The Phase 2 rules that the client named, checked at the boundary they are
 * stated at. The service enforces each of these again — and the database a
 * third time for the ones it can — but this is where a bad request is refused
 * before it reaches any of that.
 */
describe('a document needs a name, a type and a file', () => {
  const good = { name: 'Administrative sanction order', type: 'SANCTION_ORDER', fileId: 'f1' };

  it('accepts a complete one', () => {
    expect(documentInput.safeParse(good).success).toBe(true);
  });

  it('refuses one with no name', () => {
    const r = documentInput.safeParse({ type: 'SANCTION_ORDER', fileId: 'f1' });
    expect(r.success).toBe(false);
  });

  it('refuses a name that is not a name', () => {
    // "a", ".pdf", " " - the point of the rule is a human-readable title, and
    // a one-character one is the same problem as none at all.
    for (const name of ['', ' ', 'a', 'x ']) {
      expect(documentInput.safeParse({ ...good, name }).success, name).toBe(false);
    }
  });

  it('refuses one with no file', () => {
    expect(documentInput.safeParse({ name: good.name, type: good.type }).success).toBe(false);
  });

  it('refuses one with no type', () => {
    expect(documentInput.safeParse({ name: good.name, fileId: 'f1' }).success).toBe(false);
  });

  it('refuses a type that is not in the list', () => {
    expect(documentInput.safeParse({ ...good, type: 'WHATEVER' }).success).toBe(false);
  });

  it('keeps remarks optional', () => {
    expect(documentInput.safeParse({ ...good, remarks: 'Superseded by the revision' }).success).toBe(
      true,
    );
  });
});

describe('reserving a file', () => {
  it('needs a name and a type', () => {
    expect(reserveFileDto.safeParse({ fileName: 'a.pdf', mimeType: 'application/pdf' }).success).toBe(
      true,
    );
    expect(reserveFileDto.safeParse({ fileName: 'a.pdf' }).success).toBe(false);
    expect(reserveFileDto.safeParse({ mimeType: 'application/pdf' }).success).toBe(false);
  });

  it('rejects a negative or zero size outright', () => {
    const base = { fileName: 'a.pdf', mimeType: 'application/pdf' };
    expect(reserveFileDto.safeParse({ ...base, sizeBytes: 0 }).success).toBe(false);
    expect(reserveFileDto.safeParse({ ...base, sizeBytes: -1 }).success).toBe(false);
  });
});

describe('a ULB', () => {
  it('needs a code and a name', () => {
    expect(ulbDto.safeParse({ code: 'ULB-007', name: 'City 4 Municipality' }).success).toBe(true);
    expect(ulbDto.safeParse({ code: 'ULB-007' }).success).toBe(false);
  });

  it('is not the lead unless it says so', () => {
    const r = ulbDto.parse({ code: 'ULB-007', name: 'City 4 Municipality' });
    expect(r.isLead).toBe(false);
  });

  it('upper-cases the code, so ulb-7 and ULB-7 are the same ULB', () => {
    expect(ulbDto.parse({ code: 'ulb-007', name: 'City 4 Municipality' }).code).toBe('ULB-007');
  });
});

describe('project money', () => {
  const base = {
    code: 'P9',
    name: 'Project 9',
    fullName: 'A scheme with a long name',
    status: 'PLANNING' as const,
    costCr: '120.45',
    debtSanctionedCr: '90',
    debtDrawnCr: '78.10',
  };

  it('accepts amounts as strings and as numbers', () => {
    expect(createProjectDto.safeParse(base).success).toBe(true);
    expect(createProjectDto.safeParse({ ...base, costCr: 120.45 }).success).toBe(true);
  });

  it('refuses more than two decimal places, rather than rounding silently', () => {
    expect(createProjectDto.safeParse({ ...base, costCr: '120.456' }).success).toBe(false);
  });

  it('refuses a negative amount', () => {
    expect(createProjectDto.safeParse({ ...base, costCr: '-1' }).success).toBe(false);
  });

  it('refuses drawing more than was sanctioned', () => {
    const r = createProjectDto.safeParse({ ...base, debtSanctionedCr: '50', debtDrawnCr: '78' });
    expect(r.success).toBe(false);
  });

  it('refuses an end date before the start date', () => {
    const r = createProjectDto.safeParse({
      ...base,
      startDate: '2026-06-30',
      targetEndDate: '2026-01-01',
    });
    expect(r.success).toBe(false);
  });

  it('normalises the project code, because it ends up in every meeting reference', () => {
    expect(createProjectDto.parse({ ...base, code: 'p9' }).code).toBe('P9');
  });
});


/**
 * Annexures may be filed at any point in a meeting's life, which the client
 * asked for by name: the revised estimate and the countersigned letter arrive
 * when they arrive, not while the minutes are open. The cost of allowing that
 * is that the system must not imply every paper on file is inside the signed
 * PDF, because the merge runs once, at circulation.
 *
 * These read the sources as text. There is no database here, and the thing
 * worth pinning is an agreement between three files that would otherwise
 * drift apart silently - the symptom being a document numbered A-01 on screen
 * and A-04 in the PDF somebody is holding.
 */
describe('annexures filed late', () => {
  const api = process.cwd();
  const root = join(api, '..', '..');
  const documents = readFileSync(
    join(api, 'src', 'modules', 'documents', 'documents.service.ts'),
    'utf8',
  );
  const mom = readFileSync(join(api, 'src', 'modules', 'mom', 'mom.service.ts'), 'utf8');
  const minutes = readFileSync(
    join(root, 'apps', 'web', 'src', 'app', 'meetings', '[id]', 'minutes', 'page.tsx'),
    'utf8',
  );

  it('are still accepted: nothing in addToMeeting asks the stage', () => {
    const add = documents.slice(
      documents.indexOf('async addToMeeting('),
      documents.indexOf('async remove(') > -1
        ? documents.indexOf('async remove(')
        : documents.length,
    );
    expect(add).not.toMatch(/stage/);
  });

  it('are measured against the most recent circulation, so a corrigendum resets it', () => {
    const list = documents.slice(documents.indexOf('async listForMeeting('));
    expect(list).toMatch(/circulatedAt: \{ not: null \}/);
    expect(list).toMatch(/orderBy: \{ circulatedAt: 'desc' \}/);
    expect(list).toMatch(/afterCirculation: since !== null && d\.createdAt > since/);
  });

  it('are numbered in the order the merge appends them, not the order they are listed', () => {
    // The merge is oldest first; the list is newest first. The screen that
    // prints "A-01" has to sort before it counts, or the two disagree.
    const merge = mom.slice(mom.indexOf('const annexures = await tx.document.findMany'));
    expect(merge.slice(0, 300)).toMatch(/orderBy: \{ createdAt: 'asc' \}/);
    expect(minutes).toMatch(/const numbered = \[\.\.\.annexures\]\.sort\(/);
    expect(minutes).toMatch(/\{numbered\.map\(\(d, n\) =>/);
  });
});


/**
 * Deleting a filed document.
 *
 * The rule that must not bend is the one about annexures. At circulation the
 * meeting's documents are merged into the signed MoM; removing one afterwards
 * would not take it out of the PDF in two hundred inboxes, it would only make
 * this system disagree with the paper everybody is holding. That is rule 6
 * reaching one step past the MoM itself.
 *
 * A document filed *after* that circulation is a different thing - it is on
 * record but not in the signed copy, the list already marks it so, and it is
 * an ordinary attachment.
 */
describe('removing a document', () => {
  const service = readFileSync(
    join(process.cwd(), 'src', 'modules', 'documents', 'documents.service.ts'),
    'utf8',
  );
  const meeting = service.slice(service.indexOf('async removeFromMeeting('));

  it('refuses one that was circulated as an annexure', () => {
    expect(meeting).toMatch(/doc\.createdAt <= circulated\.circulatedAt/);
    expect(meeting).toMatch(/cannot be removed/);
  });

  it('measures that against the most recent circulation, as the list does', () => {
    expect(meeting.slice(0, 1400)).toMatch(/orderBy: \{ circulatedAt: 'desc' \}/);
  });

  it('names the corrigendum, because that is the way to change the minutes', () => {
    expect(meeting).toMatch(/corrigendum/i);
  });

  it('writes the audit row in the same transaction as the delete', () => {
    const erase = service.slice(service.indexOf('private async erase('));
    const tx = erase.slice(erase.indexOf('$transaction'), erase.indexOf('const shared'));
    expect(tx).toMatch(/tx\.document\.delete/);
    expect(tx).toMatch(/tx\.auditEntry\.create/);
    expect(tx).toMatch(/DOCUMENT_DELETED/);
  });

  it('keeps the bytes until nothing references them', () => {
    const erase = service.slice(service.indexOf('private async erase('));
    expect(erase).toMatch(/document\.count\(\{ where: \{ fileId: doc\.fileId \} \}\)/);
    expect(erase).toMatch(/if \(shared > 0\) return;/);
  });

  it('loses the bytes rather than the row when storage fails', () => {
    // An object nobody references costs disk. A row pointing at bytes that
    // are gone is a document that lists and cannot open.
    const erase = service.slice(service.indexOf('private async erase('));
    expect(erase.indexOf('$transaction')).toBeLessThan(erase.indexOf('files.discard'));
    expect(erase).toMatch(/catch \(err\)/);
  });

  it('leaves a project document alone, having published nothing', () => {
    // Comments stripped first: the slice runs up to removeFromMeeting's own
    // doc comment, which is all about circulation.
    const project = service
      .slice(service.indexOf('async removeFromProject('), service.indexOf('async removeFromMeeting('))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(project).not.toMatch(/circulated/);
  });
});
