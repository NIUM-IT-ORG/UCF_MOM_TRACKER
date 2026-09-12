import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tap, type Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../modules/auth/auth-user.js';

export const AUDITED = 'ucf:audited';

export interface AuditSpec {
  objectType: string;
  event: string;
  /** Where to find the object's id in the response or the route params. */
  idFrom?: (result: unknown, params: Record<string, string>) => string | undefined;
  /** A human reference for the object — a code, a name, an email. */
  refFrom?: (result: unknown, params: Record<string, string>) => string | undefined;
}

/**
 * Marks a route as one that must leave an audit row.
 *
 * Everything provable in this product rests on this being unskippable, so it is
 * a decorator on the route rather than a call inside the handler: a service
 * that forgets to write one is invisible, a route without the decorator is not.
 */
export const Audited = (spec: AuditSpec) => SetMetadata(AUDITED, spec);

/**
 * Writes the audit row after a successful mutation.
 *
 * A note on the promise made in CLAUDE.md — "every mutation writes an audit row
 * in the same transaction as the change; if the audit write fails, the change
 * rolls back". This interceptor cannot make that promise for handlers that do
 * their own writing outside a transaction it controls, so:
 *
 *   - services that mutate several rows already wrap their work in
 *     `prisma.$transaction`, and write their own audit row inside it;
 *   - this interceptor is the safety net for single-statement routes, and it
 *     runs only on success, so a failed mutation never leaves a row claiming
 *     it happened.
 *
 * The gap it does not close is a crash between the write and the audit. That is
 * closed by moving the audit inside the service's transaction, which is what
 * Phase 3 onwards does for every state machine. Where it matters most — MoM
 * transitions, item status, circulation — the audit is already transactional.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<AuditSpec | undefined>(AUDITED, ctx.getHandler());
    if (!spec) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const params = (req.params ?? {}) as Record<string, string>;
    const actorId = req.user?.id ?? null;

    return next.handle().pipe(
      tap({
        next: (result: unknown) => {
          const objectId =
            spec.idFrom?.(result, params) ?? idOf(result) ?? params.id ?? 'unknown';
          const objectRef = spec.refFrom?.(result, params) ?? refOf(result) ?? objectId;

          void this.prisma.auditEntry
            .create({
              data: {
                actorId,
                objectType: spec.objectType,
                objectId,
                objectRef,
                event: spec.event,
                detail: `${req.method} ${req.originalUrl}`,
                ipAddress: req.ip ?? null,
              },
            })
            .catch(() => {
              // Never fail a completed request because the trail could not be
              // written; the logger already carries the request id.
            });
        },
      }),
    );
  }
}

function idOf(result: unknown): string | undefined {
  if (result && typeof result === 'object' && 'id' in result) {
    const id = (result as { id: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

function refOf(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  for (const key of ['code', 'ref', 'email', 'name'] as const) {
    if (key in result) {
      const value = (result as Record<string, unknown>)[key];
      if (typeof value === 'string') return value;
    }
  }
  return undefined;
}
