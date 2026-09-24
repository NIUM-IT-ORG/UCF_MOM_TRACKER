import { describe, expect, it } from 'vitest';
import { passwordDto } from './auth.js';

/**
 * The rule from `docs/04-RBAC.md`: "Argon2id, minimum 12 characters,
 * breach-list check on set."
 *
 * It is pinned here because there are now two places a password is set — at
 * creation, and by an administrator resetting one — and they must not drift
 * apart. A reset that accepts something creation would refuse is a hole that
 * opens quietly.
 */
describe('the password rule', () => {
  it('accepts a reasonable one', () => {
    expect(passwordDto.safeParse('harbour-lantern-marigold-42').success).toBe(true);
  });

  it('refuses anything under twelve characters', () => {
    expect(passwordDto.safeParse('short1234').success).toBe(false);
    // Eleven, to pin the boundary rather than a comfortable distance from it.
    expect(passwordDto.safeParse('elevenchar1').success).toBe(false);
    expect(passwordDto.safeParse('twelvechars1').success).toBe(true);
  });

  /*
   * The real entries, not a guess at them — a test that skips when it does
   * not match is not a test.
   *
   * Only the ones twelve characters or longer reach this rule. `password`,
   * `password123` and `passw0rd123` are also on the list and are refused,
   * but by the length check, which runs first — they are unreachable as
   * breach-list entries and could be dropped without changing any outcome.
   */
  it('refuses the handful everybody tries first', () => {
    for (const p of ['letmein12345', '123456789012', 'qwertyuiop12', 'administrator']) {
      const r = passwordDto.safeParse(p);
      expect(r.success, p).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toMatch(/breach list/);
    }
  });

  it('refuses the short ones too, by length rather than by list', () => {
    for (const p of ['password', 'password123', 'passw0rd123']) {
      expect(passwordDto.safeParse(p).success, p).toBe(false);
    }
  });

  it('matches the list whatever the casing', () => {
    expect(passwordDto.safeParse('LetMeIn12345').success).toBe(false);
  });

  it('refuses one long enough to be a denial of service', () => {
    expect(passwordDto.safeParse('a'.repeat(129)).success).toBe(false);
  });
});
