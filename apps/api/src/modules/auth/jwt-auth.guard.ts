import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../common/app-error.js';
import { AuthService } from './auth.service.js';
import { TokensService } from './tokens.service.js';
import { IS_PUBLIC } from './public.decorator.js';
import type { AuthUser } from './auth-user.js';

export const ACCESS_COOKIE = 'ucf_at';
export const REFRESH_COOKIE = 'ucf_rt';

/**
 * Resolves the caller from the access token, then loads their capabilities and
 * project scope from the database — every request, not from the token.
 *
 * That is a deliberate cost. It means removing `approve_mom` from a
 * designation revokes it for everyone holding that designation on their next
 * request, with no logout and no token expiry to wait out, which is what
 * docs/04-RBAC.md §8 requires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = readToken(req);
    if (!token) throw new AppError('UNAUTHENTICATED', 'You are not signed in.');

    const claims = this.tokens.verifyAccess(token);
    const user = await this.auth.resolveUser(claims.sub);
    if (!user) {
      // The account was suspended or removed while the token was still valid.
      throw new AppError('UNAUTHENTICATED', 'This account can no longer sign in.');
    }

    req.user = user;
    return true;
  }
}

/**
 * Cookie first, Authorization header second. The browser uses the httpOnly
 * cookie; the header is for scripts and tests, which have nowhere to keep one.
 */
function readToken(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return undefined;
}
