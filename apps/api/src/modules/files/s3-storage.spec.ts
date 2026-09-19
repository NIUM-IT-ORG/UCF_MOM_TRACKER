import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { S3Storage, newObjectKey } from './storage.js';
import { AppError } from '../../common/app-error.js';

/**
 * These tests run the real AWS SDK against a real HTTP server that speaks
 * enough of the S3 protocol to answer it.
 *
 * A mocked `S3Client.send` would have proved only that we call our own code
 * the way we expect. What actually breaks in deployment is the wire: a key
 * with a backslash in it, a checksum header the bucket rejects, a 404 that
 * arrives as `NotFound` instead of `NoSuchKey` because the role lacks
 * `s3:ListBucket`. All of that is visible here and invisible to a mock.
 */

interface Recorded {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

const objects = new Map<string, { bytes: Buffer; headers: IncomingMessage['headers'] }>();
let recorded: Recorded[] = [];
/** Set to make the next request fail with this status, for the not-a-404 case. */
let failWith: number | null = null;

let server: Server;
let port: number;

const read = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

function errorXml(res: ServerResponse, status: number, code: string) {
  res.writeHead(status, { 'content-type': 'application/xml' });
  res.end(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await read(req);
    // Path-style addressing: /<bucket>/<key...>
    const url = new URL(req.url ?? '/', 'http://s3.test');
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const key = path.split('/').slice(1).join('/');
    recorded.push({ method: req.method ?? '', path, headers: req.headers, body });

    if (failWith) {
      const status = failWith;
      failWith = null;
      return errorXml(res, status, status === 403 ? 'AccessDenied' : 'InternalError');
    }

    if (req.method === 'PUT') {
      // S3 verifies the checksum it was sent and rejects the object if it
      // disagrees. So does this, because that is the behaviour being relied on.
      const claimed = req.headers['x-amz-checksum-sha256'];
      if (typeof claimed === 'string') {
        const actual = createHash('sha256').update(body).digest('base64');
        if (claimed !== actual) return errorXml(res, 400, 'BadDigest');
      }
      objects.set(key, { bytes: body, headers: req.headers });
      res.writeHead(200, { etag: '"stub"' });
      return res.end();
    }

    if (req.method === 'GET') {
      const found = objects.get(key);
      if (!found) return errorXml(res, 404, 'NoSuchKey');
      res.writeHead(200, { 'content-length': String(found.bytes.byteLength) });
      return res.end(found.bytes);
    }

    if (req.method === 'DELETE') {
      if (!objects.has(key)) return errorXml(res, 404, 'NoSuchKey');
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }

    return errorXml(res, 405, 'MethodNotAllowed');
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

beforeEach(() => {
  objects.clear();
  recorded = [];
  failWith = null;
});

const makeStorage = (prefix?: string) =>
  new S3Storage(
    new S3Client({
      region: 'ap-south-2',
      endpoint: `http://127.0.0.1:${port}`,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    }),
    { bucket: 'ucf-mom-files', prefix, serverSideEncryption: 'AES256' },
  );

describe('S3Storage', () => {
  it('round-trips bytes and reports the digest the database will record', async () => {
    const storage = makeStorage();
    const bytes = Buffer.from('%PDF-1.7 a sanction order');
    const key = newObjectKey('order.pdf');

    const stored = await storage.put(key, bytes, { contentType: 'application/pdf' });
    expect(stored.sizeBytes).toBe(bytes.byteLength);
    expect(stored.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));

    expect((await storage.get(key)).equals(bytes)).toBe(true);
  });

  it('sends the checksum, and the bucket accepts it', async () => {
    const storage = makeStorage();
    const bytes = Buffer.from('minutes of the sixth review meeting');
    await storage.put('2026/09/minutes.pdf', bytes);

    const put = recorded.find((r) => r.method === 'PUT');
    expect(put?.headers['x-amz-checksum-sha256']).toBe(
      createHash('sha256').update(bytes).digest('base64'),
    );
  });

  it('sends the content type and server-side encryption', async () => {
    const storage = makeStorage();
    await storage.put('2026/09/order.pdf', Buffer.from('x'), {
      contentType: 'application/pdf',
      fileName: 'sanction order.pdf',
    });

    const put = recorded.find((r) => r.method === 'PUT');
    expect(put?.headers['content-type']).toBe('application/pdf');
    expect(put?.headers['x-amz-server-side-encryption']).toBe('AES256');
    expect(put?.headers['x-amz-meta-original-name']).toBe('sanction order.pdf');
  });

  it('strips characters an HTTP header cannot carry out of the original name', async () => {
    const storage = makeStorage();
    // A real filename from this programme: an em dash, and Telugu.
    await storage.put('2026/09/a.pdf', Buffer.from('x'), {
      fileName: 'Zone A — పురోగతి.pdf',
    });
    const name = recorded.find((r) => r.method === 'PUT')?.headers['x-amz-meta-original-name'];
    expect(name).toBe('Zone A _ _______.pdf');
  });

  it('writes under the configured prefix, so one bucket can hold more than this', async () => {
    const storage = makeStorage('ucf/files');
    await storage.put('2026/09/order.pdf', Buffer.from('x'));
    expect(recorded[0].path).toBe('ucf-mom-files/ucf/files/2026/09/order.pdf');
    // And reads back through the same prefix rather than guessing.
    expect((await storage.get('2026/09/order.pdf')).toString()).toBe('x');
  });

  it('says not-found for a key that was never written', async () => {
    const storage = makeStorage();
    await expect(storage.get('2026/01/nothing.pdf')).rejects.toThrowError(AppError);
    await expect(storage.get('2026/01/nothing.pdf')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('removes, and treats removing something already gone as success', async () => {
    const storage = makeStorage();
    await storage.put('k.pdf', Buffer.from('x'));
    await storage.remove('k.pdf');
    await expect(storage.get('k.pdf')).rejects.toThrowError(AppError);
    // Deleting twice is what a retried cleanup job does.
    await expect(storage.remove('k.pdf')).resolves.toBeUndefined();
  });

  it('does not turn a permissions failure into a not-found', async () => {
    // The dangerous version of this driver swallows everything as 404 and the
    // officer is told the file does not exist when in fact the role is wrong.
    const storage = makeStorage();
    failWith = 403;
    await expect(storage.get('k.pdf')).rejects.not.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('object keys, on the wire', () => {
  it('never contain a backslash, whatever the platform', () => {
    const key = newObjectKey('order.pdf');
    expect(key).not.toContain('\\');
    expect(key.split('/')).toHaveLength(3);
    expect(key).toMatch(/^\d{4}\/\d{2}\//);
  });
});
