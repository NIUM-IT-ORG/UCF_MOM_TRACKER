import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ALL_CAPABILITIES, SEED_DESIGNATION_CAPS, type Capability } from '@mom/shared';
import { CapabilityGuard } from './capability.guard.js';
import { REQUIRED_CAPABILITY } from './require-capability.decorator.js';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from './auth-user.js';

/** A context that reports one required capability and one signed-in user. */
function contextFor(required: Capability | undefined, user: AuthUser | undefined) {
  const reflector = new Reflector();
  reflector.getAllAndOverride = (<T>(key: unknown): T | undefined =>
    key === REQUIRED_CAPABILITY ? (required as T | undefined) : undefined) as Reflector['getAllAndOverride'];

  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;

  return { guard: new CapabilityGuard(reflector), ctx };
}

const asDesignation = (code: keyof typeof SEED_DESIGNATION_CAPS): AuthUser => ({
  id: `u-${code}`,
  name: code,
  email: `${code}@example.gov`.toLowerCase(),
  designationCode: code,
  designationName: code,
  caps: SEED_DESIGNATION_CAPS[code] ?? [],
  projectIds: ['P1'],
  seesAllProjects: false,
});

describe('CapabilityGuard', () => {
  it('lets an unguarded route through', () => {
    const { guard, ctx } = contextFor(undefined, asDesignation('ULB'));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  const guard_ = ({ guard, ctx }: ReturnType<typeof contextFor>) => guard.canActivate(ctx);

  it('refuses a signed-out caller', () => {
    const { guard, ctx } = contextFor('approve_mom', undefined);
    expect(() => guard.canActivate(ctx)).toThrowError(AppError);
  });

  it('allows a designation that holds the capability', () => {
    // The Project Coordinator approves. This used to be the Mission Director,
    // and the change is the point of the chain: whoever validates the document
    // is not whoever signs it.
    const { guard, ctx } = contextFor('approve_mom', asDesignation('PD'));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('keeps approving and signing in different hands', () => {
    // If either of these ever passes, the routing step has become advisory.
    expect(() => guard_(contextFor('approve_mom', asDesignation('MD')))).toThrowError(AppError);
    expect(() => guard_(contextFor('approve_mom', asDesignation('AMD')))).toThrowError(AppError);
    expect(() => guard_(contextFor('sign_mom', asDesignation('PD')))).toThrowError(AppError);

    // And that each office holds the one it should.
    expect(guard_(contextFor('sign_mom', asDesignation('MD')))).toBe(true);
    expect(guard_(contextFor('sign_mom', asDesignation('AMD')))).toBe(true);
  });

  it('denies one that does not, and names the missing key', () => {
    const { guard, ctx } = contextFor('approve_mom', asDesignation('MC'));
    try {
      guard.canActivate(ctx);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.code).toBe('FORBIDDEN_CAPABILITY');
      // Naming the key is the point: "403 Forbidden" alone tells the officer
      // nothing and gives support nothing to act on.
      expect(e.details).toEqual({ capability: 'approve_mom' });
      expect(e.message).toContain('approve_mom');
    }
  });

  /*
   * docs/04-RBAC.md 8: "every capability check has a test asserting both the
   * allowed and the denied path". Rather than seventeen pairs written by hand,
   * this walks the seed matrix - which also means a capability added later
   * without a grant, or granted to nobody, shows up here.
   */
  describe('the whole matrix, both ways', () => {
    const designations = Object.keys(SEED_DESIGNATION_CAPS) as (keyof typeof SEED_DESIGNATION_CAPS)[];

    for (const cap of ALL_CAPABILITIES) {
      const holders = designations.filter((d) => (SEED_DESIGNATION_CAPS[d] ?? []).includes(cap));
      const others = designations.filter((d) => !(SEED_DESIGNATION_CAPS[d] ?? []).includes(cap));

      it(`${cap}: allowed for ${holders.join('/') || 'nobody'}, denied for the rest`, () => {
        expect(holders.length, `${cap} is granted to nobody`).toBeGreaterThan(0);

        for (const code of holders) {
          const { guard, ctx } = contextFor(cap, asDesignation(code));
          expect(guard.canActivate(ctx), `${code} should hold ${cap}`).toBe(true);
        }
        for (const code of others) {
          const { guard, ctx } = contextFor(cap, asDesignation(code));
          expect(() => guard.canActivate(ctx), `${code} should not hold ${cap}`).toThrowError(
            AppError,
          );
        }
      });
    }
  });

  it('keeps the external invitee powerless', () => {
    for (const cap of ALL_CAPABILITIES) {
      const { guard, ctx } = contextFor(cap, asDesignation('EXT'));
      expect(() => guard.canActivate(ctx)).toThrowError(AppError);
    }
  });
});
