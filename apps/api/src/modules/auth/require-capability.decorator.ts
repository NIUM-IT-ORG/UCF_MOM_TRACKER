import { SetMetadata } from '@nestjs/common';
import type { Capability } from '@mom/shared';

export const REQUIRED_CAPABILITY = 'ucf:capability';

/**
 * The capability a route needs. Typed against the shared list, so a typo is a
 * compile error rather than a route nobody can ever reach.
 */
export const RequireCapability = (cap: Capability) => SetMetadata(REQUIRED_CAPABILITY, cap);
