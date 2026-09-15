import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { ZodError, ZodIssue } from 'zod';
import { ERROR_STATUS, type ApiError, type ErrorCode } from '@mom/shared';
import { AppError } from '../app-error.js';

/**
 * The single place an error becomes a response body. Every failure leaves here
 * as `{ error: { code, message, details? } }` — including the ones thrown by
 * Nest itself and the ones nobody anticipated.
 *
 * Internal errors are logged with their stack and returned without one. A stack
 * trace in a 500 body is a gift to whoever is probing the service.
 *
 * But "Something went wrong on our side." on its own is unsupportable: the
 * officer cannot tell anyone *which* thing went wrong, and whoever reads the
 * report has nothing to search the log for. So every error carries the request
 * id that is already on the response header, and outside production a 500 also
 * carries the exception's own message — the one line that usually identifies
 * the fault, without the stack that would help somebody probing the service.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, error } = this.translate(exception);

    // pino set this on the way in, and it is already on the response header.
    const requestId =
      (req as Request & { id?: string }).id ??
      (res.getHeader('x-request-id') as string | undefined);
    if (requestId) error.requestId = requestId;

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${status} ${error.code} [${requestId ?? 'no id'}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      if (process.env.NODE_ENV !== 'production') {
        error.fault = describe(exception);
      }
    }

    res.status(status).json({ error });
  }

  private translate(exception: unknown): { status: number; error: ApiError } {
    if (exception instanceof AppError) {
      return {
        status: ERROR_STATUS[exception.code],
        error: { code: exception.code, message: exception.message, details: exception.details },
      };
    }

    // A database constraint is a *rule*, and a rule the caller broke is not a
    // server fault. Letting these fall through to a bare 500 loses both the
    // status and the only sentence that says what to do about it.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const translated = this.fromPrisma(exception);
      if (translated) return translated;
    }

    const zod = asZodError(exception);
    if (zod) {
      const fields = zod.issues.map((i: ZodIssue) => ({
        path: i.path.join('.') || '(body)',
        message: i.message,
      }));
      return {
        status: 400,
        error: {
          code: 'VALIDATION_FAILED',
          // The message names the fields. A validation error that does not say
          // which field is no better than no message at all — and `details` is
          // not always where somebody looks first.
          message: `${fields.map((f) => `${f.path}: ${f.message}`).join('; ')}`,
          details: fields,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
      return {
        status,
        error: {
          code: this.codeForStatus(status),
          message: Array.isArray(message) ? message.join('; ') : message,
        },
      };
    }

    return {
      status: 500,
      error: { code: 'INTERNAL', message: 'Something went wrong on our side.' },
    };
  }

  /**
   * The Prisma errors that are really the caller's, not ours.
   *
   * Anything not listed stays a 500 — an unrecognised database failure is a
   * defect, and dressing it up as a validation error would hide it.
   */
  private fromPrisma(
    e: Prisma.PrismaClientKnownRequestError,
  ): { status: number; error: ApiError } | null {
    const fields = Array.isArray(e.meta?.target)
      ? (e.meta.target as string[]).join(', ')
      : typeof e.meta?.target === 'string'
        ? e.meta.target
        : undefined;

    switch (e.code) {
      case 'P2002':
        return {
          status: 400,
          error: {
            code: 'VALIDATION_FAILED',
            message: fields
              ? `Something with that ${fields} already exists.`
              : 'That would duplicate a record that has to be unique.',
            details: { constraint: e.code, fields },
          },
        };
      case 'P2003':
        return {
          status: 400,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'That refers to something which does not exist.',
            details: { constraint: e.code, field: e.meta?.field_name },
          },
        };
      case 'P2025':
        return {
          status: 404,
          error: { code: 'NOT_FOUND', message: 'That was not found.' },
        };
      default:
        return null;
    }
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case 400:
        return 'VALIDATION_FAILED';
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN_CAPABILITY';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'INVALID_TRANSITION';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL';
    }
  }
}

/**
 * One line identifying the fault, for a development build.
 *
 * Prisma's errors are the ones that matter here — a failed constraint or a
 * missing relation says exactly what is wrong, and its `code` (P2002, P2003,
 * P2025 …) is searchable. The stack stays in the log where it belongs.
 */
function describe(exception: unknown): string {
  if (!(exception instanceof Error)) return String(exception);

  // A zod error's message is a pretty-printed JSON array, so the last line of
  // it is "]" — which is what an officer was actually shown once.
  const zod = asZodError(exception);
  if (zod) {
    return `ZodError: ${zod.issues
      .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
      .join('; ')}`.slice(0, 500);
  }

  const prisma = exception as Error & { code?: string; meta?: Record<string, unknown> };
  const code = typeof prisma.code === 'string' ? `${prisma.code}: ` : '';
  const target =
    prisma.meta && typeof prisma.meta === 'object' && 'target' in prisma.meta
      ? ` (${String((prisma.meta as { target: unknown }).target)})`
      : '';

  // Prisma's messages are several lines: an "Invalid `prisma.x()` invocation:"
  // header, a code frame, then the sentence that actually names the problem.
  // That last sentence is the one worth showing, so drop the scaffolding and
  // take what remains rather than the first line, which never says anything.
  const lines = exception.message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^Invalid `.*` invocation/.test(l) && !/^[→|]/.test(l) && !/^\d+\s/.test(l));
  const said = lines[lines.length - 1] ?? exception.message.trim();
  return `${exception.name}: ${code}${said}${target}`.slice(0, 500);
}

/**
 * A zod error, recognised by its shape rather than by `instanceof`.
 *
 * `instanceof ZodError` looked right and was wrong. `packages/shared` is ESM
 * and `apps/api` compiles to CommonJS, so each half loads a different build of
 * zod — the same version, from the same folder, but two module instances and
 * therefore two unrelated `ZodError` classes. Every DTO failure raised by a
 * shared schema failed that check and fell through to a bare 500, so an officer
 * who left a field blank was told "Something went wrong on our side."
 *
 * This is the dual-package hazard, and structural detection is the fix that
 * holds whatever the module graph does next.
 */
function asZodError(e: unknown): ZodError | null {
  if (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((e as { issues?: unknown }).issues)
  ) {
    return e as ZodError;
  }
  return null;
}
