import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN_LENGTH, passwordDto } from './auth.js';

/**
 * The rule from `docs/04-RBAC.md`: "Argon2id, minimum 6 characters,
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

  it('refuses anything under the minimum', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(6);
    // The boundary itself, not a comfortable distance either side of it.
    expect(passwordDto.safeParse('abc12').success).toBe(false);
    expect(passwordDto.safeParse('abc123').success).toBe(true);
  });

  /*
   * The real entries, not a guess at them.
   *
   * Every one of them now reaches this rule. At a minimum of twelve, three
   * of the list — `password`, `password123`, `passw0rd123` — were rejected
   * for being short before the list was ever consulted, so they never did
   * anything. Lowering the floor to six is what put them to work.
   */
  it('refuses the handful everybody tries first', () => {
    for (const p of [
      'password',
      'password123',
      'passw0rd123',
      'letmein12345',
      '123456789012',
      'qwertyuiop12',
      'administrator',
    ]) {
      const r = passwordDto.safeParse(p);
      expect(r.success, p).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toMatch(/breach list/);
    }
  });

  it('matches the list whatever the casing', () => {
    expect(passwordDto.safeParse('LetMeIn12345').success).toBe(false);
  });

  it('refuses one long enough to be a denial of service', () => {
    expect(passwordDto.safeParse('a'.repeat(129)).success).toBe(false);
  });
});
