import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTION_STATUS_ORDER,
  ACTION_STATUS_OPEN_FILTER,
  CLARIFICATION_STATUS_ORDER,
  CLARIFICATION_STATUS_UNCLOSED_FILTER,
} from '@mom/shared';

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
    // Named by the shared constant rather than spelled out, so the card and
    // the register's option cannot drift apart.
    const open = links.find((l) => l.includes('ACTION_STATUS_OPEN_FILTER'));
    expect(open, 'the open-actions card must exclude COMPLETED').toBeTruthy();
    expect(ACTION_STATUS_OPEN_FILTER).not.toMatch(/COMPLETED/);

    const clar = links.find((l) => l.includes('CLARIFICATION_STATUS_UNCLOSED_FILTER'));
    expect(clar, 'the clarifications card must exclude CLOSED').toBeTruthy();
    expect(CLARIFICATION_STATUS_UNCLOSED_FILTER).not.toMatch(/CLOSED/);
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


/**
 * The chart and the register have to agree, not merely both be reasonable.
 *
 * They did not. The dashboard kept its own four-colour palette, picked for
 * arc separation, so **amber was Under Review on the ring and In Progress in
 * the register** - and the chip component's own comment claimed the donuts
 * read the shared constants, asserting exactly the invariant that was broken.
 * Both files also kept private copies of the status order, next to a shared
 * one documented as "the order the donut and the register filters use".
 */
describe('the ring and the register speak one vocabulary', () => {
  it('takes its colours from shared, so a hue means one thing everywhere', () => {
    expect(dashboard).toMatch(/const ACTION_TONES = ACTION_STATUS_COLOR;/);
    expect(dashboard).toMatch(/const CLARIFICATION_TONES = CLARIFICATION_STATUS_COLOR;/);
  });

  it('carries no status palette of its own', () => {
    // The page has other colours - card tones, rules - and those are its
    // own business. What must not come back is a map from status to hex.
    expect(dashboard).not.toMatch(/Record<ActionStatus, string> = \{/);
    expect(dashboard).not.toMatch(/Record<ClarificationStatus, string> = \{/);
  });

  it('takes the ring order from shared too, on both charts', () => {
    expect(dashboard).toMatch(/const ACTION_RING = ACTION_STATUS_ORDER;/);
    expect(dashboard).toMatch(/const CLARIFICATION_RING = CLARIFICATION_STATUS_ORDER;/);
  });

  it('does not let the register redeclare the lists beside it', () => {
    expect(register).toMatch(/const ACTION_STATUSES = ACTION_STATUS_ORDER;/);
    expect(register).toMatch(/const CLARIFICATION_STATUSES = CLARIFICATION_STATUS_ORDER;/);
  });

  it('only asks for status values the register can show as chosen', () => {
    /*
     * A link the status control cannot represent leaves it reading "Any
     * status" over a filtered list. Single statuses come from the shared
     * order, which the select renders; the two combined sets need an option
     * of their own, and this is what says so.
     */
    const selectable = new Set<string>([
      ...ACTION_STATUS_ORDER,
      ...CLARIFICATION_STATUS_ORDER,
      ACTION_STATUS_OPEN_FILTER,
      CLARIFICATION_STATUS_UNCLOSED_FILTER,
    ]);
    const asked = links
      .map((l) => /(?:^|&)status=([^&]+)/.exec(l)?.[1])
      .filter((v): v is string => Boolean(v))
      .map((v) => v.replace(/\$\{(\w+)\}/, (_, name: string) =>
        name === 'ACTION_STATUS_OPEN_FILTER'
          ? ACTION_STATUS_OPEN_FILTER
          : name === 'CLARIFICATION_STATUS_UNCLOSED_FILTER'
            ? CLARIFICATION_STATUS_UNCLOSED_FILTER
            : v,
      ));

    expect(asked.length).toBeGreaterThanOrEqual(2);
    for (const value of asked) {
      // `${s}` is the donut's loop variable over the shared order.
      if (value === '${s}') continue;
      expect(selectable.has(value), value).toBe(true);
    }
  });

  it('offers the combined sets as options, by the shared constant', () => {
    expect(register).toMatch(/value=\{ACTION_STATUS_OPEN_FILTER\}/);
    expect(register).toMatch(/value=\{CLARIFICATION_STATUS_UNCLOSED_FILTER\}/);
  });
});


/**
 * Priority was captured on every action since Phase 4 and read back by
 * nothing: printed in the MoM, shown in the register, and filterable nowhere,
 * so "the Very High actions that are overdue" had no answer in the product.
 * These hold the new ring to the same rule as the other two - a slice that
 * cannot be clicked through to its own list is decoration.
 */
describe('the priority ring', () => {
  it('links each slice to that priority in the register', () => {
    const byPriority = links.filter((l) => l.includes('priority='));
    expect(byPriority.length).toBeGreaterThanOrEqual(1);
    for (const l of byPriority) {
      expect(l, l).toMatch(/(^|&)live=true/);
      expect(l, l).toMatch(/(^|&)type=ACTION/);
    }
  });

  it('takes its colours and its order from shared, as the status rings do', () => {
    expect(dashboard).toMatch(/colour: PRIORITY_COLOR\[p\]/);
    expect(dashboard).toMatch(/PRIORITY_ORDER\.map/);
  });

  it('is answerable by the register', () => {
    expect(register).toMatch(/params\.get\('priority'\)/);
    expect(service).toMatch(/where\.priority = \{ in: wanted as Priority\[\] \}/);
  });

  it('says out loud how many actions carry no priority', () => {
    // Otherwise the slices total less than the number beside the title and
    // nothing on the page explains the difference.
    expect(dashboard).toMatch(/unprioritised/);
  });
});
