import { describe, expect, it } from 'vitest';
import { movementByMonth } from './dashboard.service.js';

/**
 * The only figure on the dashboard with a direction.
 *
 * Everything else there is a snapshot, and a snapshot cannot answer what a
 * review actually opens with - whether the backlog is growing. Two things
 * make this trustworthy and both are easy to get wrong: every month in the
 * window has to appear so a quiet month reads as quiet rather than as a
 * missing bar, and "raised" has to mean circulated, not typed.
 */
const d = (iso: string) => new Date(iso);
const now = d('2026-10-05T12:00:00');

describe('twelve months of movement', () => {
  it('returns a full year, oldest first, ending with this month', () => {
    const out = movementByMonth([], now);
    expect(out).toHaveLength(12);
    expect(out[0].month).toBe('2025-11');
    expect(out[11].month).toBe('2026-10');
  });

  it('shows empty months rather than leaving them out', () => {
    const out = movementByMonth([{ activatedAt: d('2026-10-01'), closedAt: null }], now);
    expect(out.filter((m) => m.raised === 0)).toHaveLength(11);
    expect(out.every((m) => typeof m.raised === 'number')).toBe(true);
  });

  it('counts an action in the month it went live and the month it closed', () => {
    const out = movementByMonth(
      [{ activatedAt: d('2026-08-20'), closedAt: d('2026-09-02') }],
      now,
    );
    expect(out.find((m) => m.month === '2026-08')).toMatchObject({ raised: 1, closed: 0 });
    expect(out.find((m) => m.month === '2026-09')).toMatchObject({ raised: 0, closed: 1 });
  });

  it('counts both in one month when it was raised and closed inside it', () => {
    const out = movementByMonth(
      [{ activatedAt: d('2026-09-02'), closedAt: d('2026-09-28') }],
      now,
    );
    expect(out.find((m) => m.month === '2026-09')).toMatchObject({ raised: 1, closed: 1 });
  });

  it('ignores an item that is still inert, because nobody has been told of it', () => {
    const out = movementByMonth([{ activatedAt: null, closedAt: null }], now);
    expect(out.reduce((n, m) => n + m.raised + m.closed, 0)).toBe(0);
  });

  it('drops anything older than the window rather than piling it on month one', () => {
    const out = movementByMonth(
      [{ activatedAt: d('2024-01-15'), closedAt: d('2024-02-15') }],
      now,
    );
    expect(out.reduce((n, m) => n + m.raised + m.closed, 0)).toBe(0);
  });

  it('crosses a year boundary without losing December', () => {
    const out = movementByMonth([{ activatedAt: d('2025-12-31'), closedAt: null }], now);
    expect(out.find((m) => m.month === '2025-12')?.raised).toBe(1);
  });
});
