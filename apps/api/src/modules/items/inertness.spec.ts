import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Inertness is `activatedAt`, never a null status.
 *
 * This is here because getting it wrong is easy and the symptom is ugly. The
 * rule in docs/05-WORKFLOWS.md §4 reads "before `activatedAt` the item exists
 * but has no status transitions and no notifications", which invites a service
 * to store a null status — and the `items_shape` CHECK constraint then rejects
 * every item at creation, so *nothing can be raised at all*.
 *
 * That is exactly what happened while building Phase 4, and it was found by
 * running the journey rather than by reading the code. These tests read the
 * migration and the service as text so the two cannot drift apart again
 * without something failing here first.
 */

// Vitest runs with the cwd at apps/api; `import.meta` is not available here
// because this package also compiles to CommonJS for `nest build`.
const api = process.cwd();
const root = join(api, '..', '..');
const migration = readFileSync(
  join(root, 'prisma', 'migrations', '20260901000000_init', 'migration.sql'),
  'utf8',
);
const service = readFileSync(
  join(api, 'src', 'modules', 'items', 'items.service.ts'),
  'utf8',
);

describe('the items_shape constraint', () => {
  it('requires an ACTION to carry an action_status', () => {
    expect(migration).toMatch(/"type" = 'ACTION'[\s\S]*?"action_status" IS NOT NULL/);
  });

  it('requires a CLARIFICATION to carry a clarification_status', () => {
    expect(migration).toMatch(/"type" = 'CLARIFICATION'[\s\S]*?"clarification_status" IS NOT NULL/);
  });

  it('requires an ACTION to carry a due date', () => {
    expect(migration).toMatch(/"type" = 'ACTION'[\s\S]*?"due_date" IS NOT NULL/);
  });
});

describe('creating an item', () => {
  it('gives an action its opening status, so the constraint is satisfied', () => {
    expect(service).toMatch(/actionStatus: 'IN_PROGRESS'/);
    expect(service).not.toMatch(/actionStatus: null/);
  });

  /*
   * The opening status is now a choice rather than a constant: a
   * clarification answered in the meeting itself opens at RESPONDED, because
   * the MoM is generated before circulation and printing "Open" against a
   * question settled in front of everybody is a minute misreporting its own
   * meeting.
   *
   * What the constraint cares about is unchanged, and is what this asserts:
   * whichever branch is taken, a real status is written and never null.
   */
  it('gives a clarification its opening status — Open, or Responded if it was answered', () => {
    expect(service).toMatch(/clarificationStatus: dto\.response \? 'RESPONDED' : 'OPEN'/);
    expect(service).not.toMatch(/clarificationStatus: null/);
  });

  it('leaves activatedAt unset, which is what makes the item inert', () => {
    // Nothing in create *assigns* activatedAt; the column defaults to null and
    // only circulation fills it. Comments are stripped first, or this asserts
    // against its own prose rather than against the code.
    const create = code(service).slice(
      code(service).indexOf('async create('),
      code(service).indexOf('async update('),
    );
    expect(create).not.toMatch(/activatedAt\s*:/);
  });
});

describe('every liveness check asks activatedAt', () => {
  it('gates transitions on activatedAt rather than on the status', () => {
    const guard = service.slice(service.indexOf('private mustBeActive'));
    expect(guard).toMatch(/if \(!item\.activatedAt\)/);
  });

  it('says plainly why nothing happened, naming circulation', () => {
    expect(service).toMatch(/is not active yet.*signed MoM for its meeting is circulated/);
  });

  it('derives isActive from activatedAt for every row it returns', () => {
    expect(service).toMatch(/isActive: item\.activatedAt !== null/);
  });
});

/** The source with comments removed, so an assertion cannot match a remark. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
