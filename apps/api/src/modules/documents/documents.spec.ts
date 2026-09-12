import { describe, expect, it } from 'vitest';
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
