import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MonthVisibilityService, monthKey, monthRange } from './month-visibility.service.js';

/**
 * Switching a month off removes live, assigned, overdue commitments from
 * every figure on the dashboard, for everybody, and the officers responsible
 * for them are not told. That is what was asked for, and it is a loaded gun.
 *
 * These tests hold the three properties that keep it from going off:
 *
 *   absent means counted      a month nobody has configured appears on its
 *                             own, so the page never silently narrows as time
 *                             passes;
 *   nothing else is touched   the register, the reports and the meeting
 *                             screens do not consult this at all;
 *   the page says so          the dashboard reports what it is leaving out,
 *                             including how much of it is still open.
 *
 * Without the third, a dashboard reporting less than the truth looks exactly
 * like a dashboard reporting the truth.
 */
const api = process.cwd();
const root = join(api, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

const service = readFileSync(join(api, 'src', 'modules', 'dashboard', 'month-visibility.service.ts'), 'utf8');
const dashboard = readFileSync(join(api, 'src', 'modules', 'dashboard', 'dashboard.service.ts'), 'utf8');
const controller = readFileSync(join(api, 'src', 'modules', 'dashboard', 'dashboard.controller.ts'), 'utf8');
const items = readFileSync(join(api, 'src', 'modules', 'items', 'items.service.ts'), 'utf8');
const reports = readFileSync(join(api, 'src', 'modules', 'reports', 'reports.service.ts'), 'utf8');
const migration = read(
  'prisma',
  'migrations',
  '20261014000000_dashboard_month_visibility',
  'migration.sql',
);
const web = read('apps', 'web', 'src', 'app', 'page.tsx');

describe('naming a month', () => {
  /*
   * In UTC throughout. `meetings.meeting_date` is a Postgres `date` and
   * Prisma hands it back as midnight UTC; building the boundaries locally
   * slid the window by the server's offset, leaving the 1st of a
   * switched-off month still counted and dropping the 1st of the next one
   * instead. It was correct on a UTC or IST machine and wrong at UTC-4.
   *
   * These assert against the exact values Prisma produces, so a return to
   * local-time arithmetic fails here rather than in somebody's figures.
   */
  it('uses the meeting month, zero padded', () => {
    expect(monthKey(new Date('2026-09-23T00:00:00.000Z'))).toBe('2026-09');
    expect(monthKey(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01');
    expect(monthKey(new Date('2026-12-31T00:00:00.000Z'))).toBe('2026-12');
  });

  it('names the first and last day of a month as that month, in any zone', () => {
    // The two days a local-time reading gets wrong.
    expect(monthKey(new Date('2026-09-01T00:00:00.000Z'))).toBe('2026-09');
    expect(monthKey(new Date('2026-09-30T00:00:00.000Z'))).toBe('2026-09');
  });

  it('covers a month as a half-open range, so no day lands in two months', () => {
    const { gte, lt } = monthRange('2026-09');
    expect(gte.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(lt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('takes in every day of the month a date column can hold', () => {
    const { gte, lt } = monthRange('2026-09');
    const day = (iso: string) => new Date(iso);
    expect(day('2026-09-01T00:00:00.000Z') >= gte).toBe(true);
    expect(day('2026-09-30T00:00:00.000Z') < lt).toBe(true);
    // And neither neighbour.
    expect(day('2026-08-31T00:00:00.000Z') >= gte).toBe(false);
    expect(day('2026-10-01T00:00:00.000Z') < lt).toBe(false);
  });

  it('rolls December into the next January rather than month thirteen', () => {
    const { gte, lt } = monthRange('2026-12');
    expect(gte.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('builds one clause per disabled month, against the meeting date', () => {
    const clauses = MonthVisibilityService.excludeClause(['2026-08', '2026-09']);
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toEqual({ meeting: { meetingDate: monthRange('2026-08') } });
  });

  it('builds nothing when nothing is switched off', () => {
    expect(MonthVisibilityService.excludeClause([])).toEqual([]);
  });
});

describe('a month nobody has configured', () => {
  it('is counted, because only disabled rows are read', () => {
    const q = service.slice(service.indexOf('async disabledMonths('));
    expect(q).toMatch(/where: \{ enabled: false \}/);
  });

  it('is counted on the admin list too, rather than appearing as off', () => {
    expect(service).toMatch(/enabled: set\?\.enabled \?\? true/);
  });

  it('is what the database defaults to', () => {
    expect(migration).toMatch(/"enabled"\s+BOOLEAN\s+NOT NULL DEFAULT true/);
  });
});

describe('what a switched-off month does and does not reach', () => {
  it('is applied to the dashboard item figures', () => {
    expect(dashboard).toMatch(/const disabled = await this\.months\.disabledMonths\(\)/);
    expect(dashboard).toMatch(/NOT: MonthVisibilityService\.excludeClause\(disabled\)/);
  });

  it('reaches the per-project rows, which build their own where', () => {
    // These were a separate `where` built from LIVE and would otherwise have
    // gone on counting the months the headline figures had dropped.
    const byProject = dashboard.slice(dashboard.indexOf('const byProject'));
    expect([...byProject.matchAll(/\.\.\.excludeMonths,/g)]).toHaveLength(3);
  });

  it('reaches the twelve-month movement chart', () => {
    const movement = dashboard.slice(
      dashboard.indexOf('this.prisma.item.findMany({'),
      dashboard.indexOf('select: { activatedAt: true, closedAt: true }'),
    );
    expect(movement).toMatch(/\.\.\.excludeMonths,/);
  });

  it('does not reach the register', () => {
    expect(items).not.toMatch(/dashboardMonth|disabledMonths|excludeClause/);
  });

  it('does not reach the reports', () => {
    expect(reports).not.toMatch(/dashboardMonth|disabledMonths|excludeClause/);
  });

  it('writes to no item: this is a reporting window, not a status', () => {
    const body = service.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(body).not.toMatch(/\bitem\.update|updateMany/);
  });
});

describe('the page says what it is leaving out', () => {
  it('the API reports the hidden months and their counts', () => {
    expect(dashboard).toMatch(/hidden: disabled\.length > 0 \? await this\.hiddenSummary/);
    expect(dashboard).toMatch(/return \{ months, actions, clarifications, open \}/);
  });

  it('counts the still-open ones separately, which is the figure that matters', () => {
    const summary = dashboard.slice(dashboard.indexOf('private async hiddenSummary'));
    expect(summary).toMatch(/IN_PROGRESS', 'DELAYED', 'UNDER_REVIEW'/);
    expect(summary).toMatch(/'OPEN', 'RESPONDED'/);
  });

  it('counts them live and in scope, so the number reconciles with the page', () => {
    const summary = dashboard.slice(dashboard.indexOf('private async hiddenSummary'));
    expect(summary).toMatch(/\.\.\.projectScope\(user\)/);
    expect(summary).toMatch(/\.\.\.LIVE/);
  });

  it('and the dashboard renders it rather than quietly showing a smaller number', () => {
    expect(web).toMatch(/data\?\.hidden &&/);
    expect(web).toMatch(/still open/);
  });
});

describe('only an administrator may change it', () => {
  it('gates both routes on manage_masters', () => {
    const months = controller.slice(controller.indexOf("@Get('months')"));
    expect([...months.matchAll(/@RequireCapability\('manage_masters'\)/g)]).toHaveLength(2);
  });

  it('refuses anything that is not a month', () => {
    expect(controller).toMatch(/\^\[0-9\]\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$/);
    // And again in the database, which is the one that cannot be bypassed.
    expect(migration).toMatch(/dashboard_months_month_format/);
  });

  it('audits every change in the same transaction as the change', () => {
    const set = service.slice(service.indexOf('async set('));
    const tx = set.slice(set.indexOf('$transaction'));
    expect(tx).toMatch(/tx\.dashboardMonth\.upsert/);
    expect(tx).toMatch(/tx\.auditEntry\.create/);
    expect(tx).toMatch(/DASHBOARD_MONTH_DISABLED/);
  });

  it('records decisions rather than clicks', () => {
    // Re-stating what is already set writes no audit row.
    const set = service.slice(service.indexOf('async set('));
    expect(set).toMatch(/if \(was === c\.enabled\) continue;/);
  });
});
