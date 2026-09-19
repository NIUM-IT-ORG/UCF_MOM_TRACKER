import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

/**
 * The production guards.
 *
 * Each of these exists because the failure it prevents is silent. A queue that
 * loses messages, a bucket setting that quietly writes to a disposable disk,
 * an email sink that fills a server with .eml files nobody reads — none of
 * them raise an error at the time, and all of them are discovered much later
 * by someone asking where a document went.
 *
 * They are also exactly the checks that get deleted by a future commit trying
 * to make the thing start. So they are pinned here, with the reason attached.
 */
const base = {
  DATABASE_URL: 'postgresql://ucf:pw@localhost:5432/mom_tracker?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

const production = {
  ...base,
  NODE_ENV: 'production',
  QUEUE_DRIVER: 'bullmq',
  REDIS_URL: 'redis://127.0.0.1:6379',
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'ucf-mom-files',
  S3_REGION: 'ap-south-2',
  EMAIL_PROVIDER: 'none',
};

const load = (over: Record<string, string> = {}) =>
  loadEnv({ ...production, ...over } as NodeJS.ProcessEnv);

describe('development defaults', () => {
  it('start with nothing but a database and two secrets', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.QUEUE_DRIVER).toBe('memory');
    expect(env.EMAIL_PROVIDER).toBe('console');
  });
});

describe('the deployed configuration', () => {
  it('is accepted: WhatsApp-only, S3, BullMQ', () => {
    const env = load();
    expect(env.EMAIL_PROVIDER).toBe('none');
    expect(env.STORAGE_DRIVER).toBe('s3');
    expect(env.S3_REGION).toBe('ap-south-2');
  });

  it('refuses local storage, because the instance disk is replaced on every deploy', () => {
    expect(() => load({ STORAGE_DRIVER: 'local' })).toThrowError(/instance filesystem/);
    expect(() => load({ STORAGE_DRIVER: 'memory' })).toThrowError(/instance filesystem/);
  });

  it('refuses the in-memory queue, which loses whatever was queued on restart', () => {
    expect(() => load({ QUEUE_DRIVER: 'memory', REDIS_URL: '' })).toThrowError(/bullmq/);
  });

  it('refuses the console email sink, and names the WhatsApp-only setting', () => {
    expect(() => load({ EMAIL_PROVIDER: 'console' })).toThrowError(/EMAIL_PROVIDER=none/);
  });

  it('refuses s3 without a bucket rather than starting and failing on first upload', () => {
    expect(() => load({ S3_BUCKET: '' })).toThrowError(/requires S3_BUCKET/);
  });

  it('refuses bullmq without Redis', () => {
    expect(() => load({ REDIS_URL: '' })).toThrowError(/requires REDIS_URL/);
  });

  it('refuses a short signing secret', () => {
    expect(() => load({ JWT_ACCESS_SECRET: 'short' })).toThrowError(/at least 16/);
  });
});
