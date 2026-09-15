import { Prisma } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { ZodError, z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiError } from '@mom/shared';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppError } from '../app-error.js';

/**
 * A 500 that says only "Something went wrong on our side." is unsupportable:
 * the officer cannot tell anyone which thing went wrong, and whoever reads the
 * report has nothing to search the log for. These tests hold the line on what
 * a failure has to carry.
 */

const ENV = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = ENV;
});

function run(exception: unknown, nodeEnv = 'development') {
  process.env.NODE_ENV = nodeEnv;
  let status = 0;
  let body: { error: ApiError } = { error: { code: 'INTERNAL', message: '' } };

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status(s: number) {
          status = s;
          return this;
        },
        json(b: { error: ApiError }) {
          body = b;
        },
        getHeader: () => undefined,
      }),
      getRequest: () => ({ method: 'POST', originalUrl: '/api/v1/items', id: 'req-abc-123' }),
    }),
  };

  // The logger writes to stderr on a 500; that is wanted in production and
  // noise here.
  const quiet = { error: () => {}, log: () => {} };
  const filter = new AllExceptionsFilter();
  Object.assign(filter, { logger: quiet });

  filter.catch(exception, host as never);
  return { status, error: body.error };
}

const prismaError = (code: string, message: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '5.22.0', meta });

describe('every error carries a request id', () => {
  it('puts it on a 500', () => {
    expect(run(new TypeError('boom')).error.requestId).toBe('req-abc-123');
  });

  it('puts it on a deliberate refusal too', () => {
    expect(run(AppError.notFound('That meeting')).error.requestId).toBe('req-abc-123');
  });

  it('puts it on a validation failure', () => {
    const err = new ZodError(z.string().safeParse(1).error?.issues ?? []);
    expect(run(err).error.requestId).toBe('req-abc-123');
  });
});

describe('a 500 names the fault outside production', () => {
  it('reports the exception type and message', () => {
    const { status, error } = run(new TypeError("Cannot read properties of undefined (reading 'id')"));
    expect(status).toBe(500);
    expect(error.fault).toBe("TypeError: Cannot read properties of undefined (reading 'id')");
  });

  it('digs the useful sentence out of a Prisma message', () => {
    // Prisma leads with "Invalid `prisma.x()` invocation:" and a code frame.
    // The sentence that names the problem is the last one.
    const e = prismaError(
      'P2010',
      'Invalid `prisma.item.create()` invocation:\n\n\nNew row for relation "items" violates check constraint "items_shape"',
    );
    expect(run(e).error.fault).toContain('violates check constraint "items_shape"');
    expect(run(e).error.fault).not.toContain('invocation');
  });

  it('says nothing in production — a stack is a gift to an attacker', () => {
    const { status, error } = run(new TypeError('boom'), 'production');
    expect(status).toBe(500);
    expect(error.fault).toBeUndefined();
    // The reference still goes out: it identifies the log line without
    // revealing anything about the failure itself.
    expect(error.requestId).toBe('req-abc-123');
  });

  it('never leaks a stack, in either environment', () => {
    const e = new Error('boom');
    e.stack = 'Error: boom\n    at secretInternals (/srv/app/dist/secret.js:12:3)';
    for (const env of ['development', 'production']) {
      expect(JSON.stringify(run(e, env).error)).not.toContain('secretInternals');
    }
  });
});

describe('a broken database rule is the caller’s fault, not a 500', () => {
  it('turns a unique violation into a 400 naming the field', () => {
    const { status, error } = run(prismaError('P2002', 'Unique failed', { target: ['ref'] }));
    expect(status).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('ref');
  });

  it('turns a foreign-key violation into a 400', () => {
    const { status, error } = run(
      prismaError('P2003', 'FK failed', { field_name: 'items_raised_by_id_fkey' }),
    );
    expect(status).toBe(400);
    expect(error.message).toMatch(/does not exist/);
  });

  it('turns a missing record into a 404', () => {
    expect(run(prismaError('P2025', 'Not found')).status).toBe(404);
  });

  it('leaves an unrecognised Prisma error as a 500 — hiding it would be worse', () => {
    const { status, error } = run(prismaError('P2010', 'Raw query failed'));
    expect(status).toBe(500);
    expect(error.code).toBe('INTERNAL');
  });
});

describe('the documented codes keep their documented statuses', () => {
  it.each([
    ['NOT_FOUND', 404],
    ['FORBIDDEN_CAPABILITY', 403],
    ['AGENDA_FROZEN', 409],
    ['MINUTES_LOCKED', 409],
    ['MOM_IMMUTABLE', 409],
    ['REVISED_DUE_REQUIRED', 422],
  ] as const)('%s → %i', (code, status) => {
    expect(run(new AppError(code, 'x')).status).toBe(status);
  });

  it('passes a Nest HttpException through with its own status', () => {
    expect(run(new HttpException('Too big', 413)).status).toBe(413);
  });
});

describe('a validation failure from the shared package is still a validation failure', () => {
  /**
   * `packages/shared` is ESM and `apps/api` compiles to CommonJS, so the two
   * halves load different builds of zod. A DTO error raised by a shared schema
   * is therefore NOT an instance of the ZodError class this file can see. It
   * used to fall through to a bare 500, and an officer who left a field blank
   * was told "Something went wrong on our side."
   *
   * This fake is that foreign error: the right shape, the wrong class.
   */
  class ForeignZodError extends Error {
    override name = 'ZodError';
    constructor(readonly issues: { path: (string | number)[]; message: string }[]) {
      // zod's own message is a pretty-printed JSON array, whose last line is "]".
      super(JSON.stringify(issues, null, 2));
    }
  }

  const foreign = new ForeignZodError([
    { path: ['name'], message: 'give the document a name' },
    { path: ['fileId'], message: 'Invalid cuid' },
  ]);

  it('is a 400, not a 500', () => {
    expect(run(foreign).status).toBe(400);
    expect(run(foreign).error.code).toBe('VALIDATION_FAILED');
  });

  it('is not an instance of this half of the module graph — which is the point', () => {
    expect(foreign instanceof ZodError).toBe(false);
  });

  it('names every field that failed, in the message and not only in the details', () => {
    const { error } = run(foreign);
    expect(error.message).toContain('name: give the document a name');
    expect(error.message).toContain('fileId: Invalid cuid');
    expect(error.details).toEqual([
      { path: 'name', message: 'give the document a name' },
      { path: 'fileId', message: 'Invalid cuid' },
    ]);
  });

  it('never shows "]" as the fault — that is what was on screen', () => {
    const local = new ZodError(z.object({ name: z.string() }).safeParse({}).error?.issues ?? []);
    for (const e of [foreign, local]) {
      const { error } = run(e);
      expect(error.fault ?? '').not.toBe(']');
      expect(error.message.trim()).not.toBe(']');
    }
  });

  it('a body with no issues at all is still not a 500', () => {
    expect(run(new ForeignZodError([])).status).toBe(400);
  });
});
