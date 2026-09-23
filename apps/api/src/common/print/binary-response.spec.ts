import { Controller, Get, Header, INestApplication, Res } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js';
import {
  EnvelopeInterceptor,
  RawResponse,
} from '../interceptors/envelope.interceptor.js';

/**
 * How a PDF actually leaves this server.
 *
 * Every other test of the printed documents checks the bytes we hand to the
 * HTTP layer. None of them checked what the HTTP layer then does with them —
 * and that turned out to be the thing that was broken: a valid PDF was being
 * produced and then mangled on its way out, which is invisible from a unit
 * test and shows up in a browser only as "Failed to load PDF document".
 *
 * So this boots a real Nest application over a real socket and asserts the
 * bytes that come back are the bytes that went in.
 */

// A four-byte stand-in with a PDF's magic number, which is all a reader
// actually looks at to decide whether this is a document or a mistake.
const BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0xff, 0x0a]);

@Controller()
class PdfController {
  /** The shape the real routes use. */
  @Get('good.pdf')
  @RawResponse()
  @Header('x-content-type-options', 'nosniff')
  good(@Res() res: Response) {
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline; filename="good.pdf"');
    res.send(BYTES);
  }
}

describe('a PDF route returns the bytes, not a description of them', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PdfController],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves it as application/pdf', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/good.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  /*
   * The one that matters. Nest replies with `res.json(body)` for anything
   * `typeof body === 'object'`, and a Buffer is an object — so a handler that
   * *returns* a Buffer sends `{"type":"Buffer","data":[37,80,68,70,...]}` with
   * whatever content type was set. The header says PDF, the body is a JSON
   * description of a PDF, and the viewer fails with nothing useful to say.
   */
  it('does not JSON-encode the buffer', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/good.pdf')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.toString('latin1')).not.toContain('"type":"Buffer"');
    expect(body.equals(BYTES)).toBe(true);
  });
});
