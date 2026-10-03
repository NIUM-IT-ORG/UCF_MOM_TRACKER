import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every figure on the dashboard is a link into the register, and the list it
 * opens has to be the set that was counted.
 *
 * It was not. The register read nothing from the query string, so "12 open
 * action items" opened all 338 rows - and even once it read the URL, the
 * links carried only `type=ACTION`, which is every action ever raised rather
 * than the live, not-completed ones the card counts. A figure that opens a
 * list disagreeing with it is worse than no link: it reads as though the
 * count is wrong.
 *
 * Read as text, because the alternative is a browser. What these hold is the
 * agreement between three files - what the service counts, what the link
 * asks for, and what the register knows how to apply.
 */
const api = process.cwd();
const root = join(api, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

const dashboard = read('apps', 'web', 'src', 'app', 'page.tsx');
const register = read('apps', 'web', 'src', 'app', 'register', 'page.tsx');
const service = readFileSync(join(api, 'src', 'modules', 'items', 'items.service.ts'), 'utf8');
const dto = read('packages', 'shared', 'src', 'dto', 'item.ts');

/** Every `/register?…` target on the dashboard. */
const links = [...dashboard.matchAll(/\/register\?([^`"'\s]+)/g)].map((m) => m[1]);

describe('the dashboard links', () => {
  it('has some, or this file is asserting nothing', () => {
    expect(links.length).toBeGreaterThanOrEqual(6);
  });

  it('asks for live items only, because that is all the page counts', () => {
    // The dashboard's own rule: "an item counts only once it is live."
    for (const link of links) expect(link, link).toMatch(/(^|&)live=true/);
  });

  it('narrows to a status wherever the figure is not the whole ring', () => {
    const open = links.find((l) => l.includes('IN_PROGRESS,DELAYED,UNDER_REVIEW'));
    expect(open, 'the open-actions card must exclude COMPLETED').toBeTruthy();
    expect(open).not.toMatch(/COMPLETED/);

    const clar = links.find((l) => l.includes('OPEN,RESPONDED'));
    expect(clar, 'the clarifications card must exclude CLOSED').toBeTruthy();
    expect(clar).not.toMatch(/status=[^&]*CLOSED/);
  });

  it('sends "past their date" to the overdue filter, not to the Delayed status', () => {
    // Delayed is a status an officer set; past-their-date is computed, and on
    // the reported data they were 2 and 9.
    const late = links.find((l) => l.includes('overdue=true'));
    expect(late).toBeTruthy();
    expect(late).not.toMatch(/status=DELAYED/);
  });
});

describe('the register can answer what the dashboard asks', () => {
  it('reads every filter it is sent from the query string', () => {
    for (const key of ['type', 'status', 'projectId', 'q', 'overdue', 'live', 'ownerId', 'item']) {
      // String.raw, not a plain template: `\(` in a template literal is just
      // `(`, which turns the pattern into a capture group matching nothing.
      expect(register, key).toMatch(new RegExp(String.raw`params\.get\('${key}'\)`));
    }
  });

  it('offers the live filter as a control, so nobody is shown a subset in silence', () => {
    expect(register).toMatch(/Live only/);
  });

  it('applies it as rule 4 does, on activatedAt', () => {
    expect(service).toMatch(/if \(query\.live\) where\.activatedAt = \{ not: null \}/);
  });

  it('takes the flag off the query string without treating "false" as true', () => {
    // z.coerce.boolean() is Boolean(value), so "false" arrives as true.
    expect(dto).not.toMatch(/(overdue|live): z\.coerce\.boolean\(\)/);
    expect(dto).toMatch(/overdue: flag/);
    expect(dto).toMatch(/live: flag/);
  });
});
