import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { AppError } from '../../common/app-error.js';

export interface StoredObject {
  sizeBytes: number;
  sha256: string;
}

/** What the caller knows about the bytes that the store cannot work out itself. */
export interface ObjectMeta {
  /** Sent as Content-Type, so a presigned link opens rather than downloads as binary. */
  contentType?: string;
  /** The officer's own filename, kept as object metadata for forensics. */
  fileName?: string;
}

/**
 * Where uploaded bytes live.
 *
 * One interface, three implementations, chosen by `STORAGE_DRIVER`. Development
 * writes to a folder; the server writes to S3. The rule that does not bend
 * either way: uploads never live on the application filesystem in production,
 * because the next deployment replaces that filesystem — and on the deployed
 * shape the box itself is disposable while the bucket is not.
 */
export interface StorageDriver {
  put(key: string, bytes: Buffer, meta?: ObjectMeta): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

/** Bytes on local disk, under LOCAL_STORAGE_DIR. Development only. */
export class LocalStorage implements StorageDriver {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    // A key is server-generated, but treat it as hostile anyway: one traversal
    // here would let an upload land anywhere the process can write.
    const base = resolve(this.root);
    if (full !== base && !full.startsWith(base + sep)) {
      throw new AppError('VALIDATION_FAILED', 'That storage key is not allowed.');
    }
    return full;
  }

  async put(key: string, bytes: Buffer): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return digestOf(bytes);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      throw AppError.notFound('That file');
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

/**
 * Holds bytes in memory. For tests and for CI, where nothing should touch disk
 * and nothing needs to survive the process.
 */
export class MemoryStorage implements StorageDriver {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, bytes: Buffer): Promise<StoredObject> {
    this.objects.set(key, bytes);
    return digestOf(bytes);
  }

  async get(key: string): Promise<Buffer> {
    const found = this.objects.get(key);
    if (!found) throw AppError.notFound('That file');
    return found;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export interface S3StorageOptions {
  bucket: string;
  /** Everything this application writes sits under one prefix, so a bucket can be shared. */
  prefix?: string;
  /** AES256, or aws:kms with a key. The bucket's default encryption applies either way; this is belt and braces. */
  serverSideEncryption?: 'AES256' | 'aws:kms';
  kmsKeyId?: string;
}

/**
 * Bytes in S3.
 *
 * Three things here are deliberate and worth not undoing:
 *
 * 1. **No credentials in the constructor.** The client is handed in, and the
 *    service builds it from the default provider chain, which on EC2 means the
 *    instance profile. Keys in an environment file are the fallback, not the
 *    plan: a role rotates itself and cannot be pasted into a chat message.
 *
 * 2. **The checksum travels with the upload.** We already compute SHA-256 for
 *    the `stored_files` row, so sending it as `ChecksumSHA256` costs nothing
 *    and makes S3 reject the object if a byte changed in flight. A minute of
 *    a government meeting that silently corrupts is worse than one that fails
 *    to save.
 *
 * 3. **A missing object is a 404, not a 500.** The bucket is a different
 *    machine; "it isn't there" is an ordinary answer and the application
 *    already knows how to say it.
 */
export class S3Storage implements StorageDriver {
  constructor(
    private readonly client: S3Client,
    private readonly options: S3StorageOptions,
  ) {}

  /** Object keys are always POSIX. `path.join` on Windows would write `2026\09\…`. */
  private keyFor(key: string): string {
    const prefix = (this.options.prefix ?? '').replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/${key}` : key;
  }

  async put(key: string, bytes: Buffer, meta?: ObjectMeta): Promise<StoredObject> {
    const digest = digestOf(bytes);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: this.keyFor(key),
        Body: bytes,
        ContentType: meta?.contentType,
        ChecksumSHA256: Buffer.from(digest.sha256, 'hex').toString('base64'),
        ServerSideEncryption: this.options.serverSideEncryption,
        SSEKMSKeyId: this.options.kmsKeyId,
        Metadata: meta?.fileName ? { 'original-name': asciiHeader(meta.fileName) } : undefined,
      }),
    );
    return digest;
  }

  async get(key: string): Promise<Buffer> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: this.keyFor(key) }),
      );
      const body = out.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) throw AppError.notFound('That file');
      return Buffer.from(await body.transformToByteArray());
    } catch (err) {
      if (isMissing(err)) throw AppError.notFound('That file');
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.keyFor(key) }),
      );
    } catch (err) {
      // Deleting something that is already gone is the outcome we wanted.
      if (!isMissing(err)) throw err;
    }
  }
}

/**
 * Does this error mean "no such object"?
 *
 * Written structurally rather than with `instanceof NoSuchKey` on purpose. The
 * SDK reports a missing key three different ways depending on whether the
 * caller has `s3:ListBucket` — `NoSuchKey`, `NotFound`, or a bare 404 — and a
 * bucket policy change should not turn a 404 into a 500.
 */
function isMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  if (e.$metadata?.httpStatusCode === 404) return true;
  const name = e.name ?? e.Code ?? '';
  return name === 'NoSuchKey' || name === 'NotFound';
}

function digestOf(bytes: Buffer): StoredObject {
  return {
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** S3 user metadata is sent as an HTTP header, which is Latin-1 at best. */
function asciiHeader(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '_').slice(0, 200);
}

@Injectable()
export class StorageService implements StorageDriver {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;

  constructor(private readonly config: ConfigService) {
    const kind = this.config.get<string>('STORAGE_DRIVER') ?? 'local';

    if (kind === 'memory') {
      this.driver = new MemoryStorage();
    } else if (kind === 's3') {
      this.driver = this.buildS3();
    } else {
      const root = this.config.get<string>('LOCAL_STORAGE_DIR') ?? './var/files';
      this.driver = new LocalStorage(resolve(process.cwd(), root));
      this.logger.log(`Files are stored under ${resolve(process.cwd(), root)}`);
    }
  }

  private buildS3(): StorageDriver {
    const bucket = this.config.get<string>('S3_BUCKET');
    // loadEnv already refuses this combination; the check is here because this
    // constructor is also reachable from a test that builds config by hand.
    if (!bucket) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET.');

    const region = this.config.get<string>('S3_REGION') ?? 'ap-south-2';
    const endpoint = this.config.get<string>('S3_ENDPOINT') || undefined;
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');

    const clientConfig: S3ClientConfig = { region, endpoint };
    if (endpoint) {
      // MinIO and most S3-compatible stores do not do virtual-host addressing.
      clientConfig.forcePathStyle = true;
    }
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
      this.logger.warn(
        'Using S3 credentials from the environment. On EC2, prefer an instance role: ' +
          'leave S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY unset and attach an IAM role.',
      );
    } else {
      this.logger.log(`S3 credentials come from the instance role (region ${region}).`);
    }

    const sse = this.config.get<string>('S3_SSE');
    const driver = new S3Storage(new S3Client(clientConfig), {
      bucket,
      prefix: this.config.get<string>('S3_PREFIX') || undefined,
      serverSideEncryption: sse === 'aws:kms' || sse === 'AES256' ? sse : 'AES256',
      kmsKeyId: this.config.get<string>('S3_KMS_KEY_ID') || undefined,
    });
    this.logger.log(`Files are stored in s3://${bucket}${endpoint ? ` via ${endpoint}` : ''}`);
    return driver;
  }

  put(key: string, bytes: Buffer, meta?: ObjectMeta): Promise<StoredObject> {
    return this.driver.put(key, bytes, meta);
  }
  get(key: string): Promise<Buffer> {
    return this.driver.get(key);
  }
  remove(key: string): Promise<void> {
    return this.driver.remove(key);
  }
}

/**
 * A key nobody can guess and nothing can collide with.
 *
 * Always POSIX separators. This used to use `path.join`, which on a Windows
 * development machine produced `2026\09\uuid-name.pdf` — harmless as a
 * filesystem path, and a single object literally named `2026\09\…` once the
 * same key reaches S3.
 */
export function newObjectKey(fileName: string): string {
  const now = new Date();
  const safe = fileName
    .replace(/[^A-Za-z0-9._-]/g, '_')
    // Runs of dots collapse too. Without a separator `..` cannot traverse
    // anything, but leaving it in a key means every later reader has to work
    // that out for themselves.
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '')
    .slice(-80);
  return [
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${randomUUID()}-${safe}`,
  ].join('/');
}
