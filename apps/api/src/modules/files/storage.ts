import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/app-error.js';

export interface StoredObject {
  sizeBytes: number;
  sha256: string;
}

/**
 * Where uploaded bytes live.
 *
 * One interface, two implementations, chosen by `STORAGE_DRIVER`. Development
 * writes to a folder; a server writes to S3-compatible storage. The rule that
 * does not bend either way: uploads never live on the application filesystem
 * in production, because the next deployment replaces that filesystem.
 */
export interface StorageDriver {
  put(key: string, bytes: Buffer): Promise<StoredObject>;
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
    return {
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
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
    return {
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
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

@Injectable()
export class StorageService implements StorageDriver {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;

  constructor(private readonly config: ConfigService) {
    const kind = this.config.get<string>('STORAGE_DRIVER') ?? 'local';
    if (kind === 'memory') {
      this.driver = new MemoryStorage();
    } else if (kind === 's3') {
      // Phase 7 wires the real client; the interface is what matters now, and
      // the environment validator already refuses s3 without a bucket.
      throw new Error(
        'STORAGE_DRIVER=s3 is not implemented yet. Use local in development; ' +
          'the S3 driver lands with deployment in Phase 7.',
      );
    } else {
      const root = this.config.get<string>('LOCAL_STORAGE_DIR') ?? './var/files';
      this.driver = new LocalStorage(resolve(process.cwd(), root));
      this.logger.log(`Files are stored under ${resolve(process.cwd(), root)}`);
    }
  }

  put(key: string, bytes: Buffer): Promise<StoredObject> {
    return this.driver.put(key, bytes);
  }
  get(key: string): Promise<Buffer> {
    return this.driver.get(key);
  }
  remove(key: string): Promise<void> {
    return this.driver.remove(key);
  }
}

/** A key nobody can guess and nothing can collide with. */
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
  return join(
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${randomUUID()}-${safe}`,
  );
}
