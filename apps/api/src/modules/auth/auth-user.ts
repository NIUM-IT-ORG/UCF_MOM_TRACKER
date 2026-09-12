import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/**
 * The caller, as resolved by JwtAuthGuard on this request.
 *
 * `caps` and `projectIds` are read from the database every time, never from
 * the token — so an access change takes effect on the next request rather than
 * at the next sign-in. That is the whole point of docs/04-RBAC.md §5.
 */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  designationCode: string;
  caps: string[];
  projectIds: string[];
  seesAllProjects: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) {
      // Reaching a handler without a user means the guard was left off.
      throw new Error('CurrentUser used on a route with no JwtAuthGuard');
    }
    return req.user;
  },
);
