import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasCapability, type Capability } from '@mom/shared';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from './auth-user.js';
import { REQUIRED_CAPABILITY } from './require-capability.decorator.js';

/**
 * Enforces @RequireCapability. Denials name the missing key, because "403
 * Forbidden" with nothing else is the least useful message in software - the
 * officer cannot ask for the right thing and support cannot answer them.
 *
 * Capability only. Whether the caller may touch this particular row is project
 * scope and object-level rules, which live in the repositories and services.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Capability | undefined>(
      REQUIRED_CAPABILITY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) throw new AppError('UNAUTHENTICATED', 'You are not signed in.');

    if (!hasCapability(req.user.caps, required)) throw AppError.forbidden(required);
    return true;
  }
}
