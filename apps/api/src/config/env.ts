import { z } from 'zod';

/**
 * The environment is validated once, at boot, and the process refuses to start
 * if it is wrong. A missing secret discovered at 3am under load is a much worse
 * error message than this one.
 *
 * Two settings are deliberately provider-agnostic while the client decides
 * (docs/01-PRD.md §9): EMAIL_PROVIDER and the hosting target. Nothing managed
 * is assumed anywhere in this file.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  API_PREFIX: z.string().default('api/v1'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  APP_TZ: z.string().default('Asia/Kolkata'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'use at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'use at least 16 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),

  /**
   * The one-time code on sign-in.
   *
   * `docs/01-PRD.md` asks for it, and it stays the default. It is switchable
   * because the code has to reach the officer somehow, and until Phase 5
   * delivers by e-mail and WhatsApp there is no way to send it: in production
   * the code was generated, withheld, and delivered by nothing, so nobody
   * could sign in at all. The alternative in use was an uncommitted patch on
   * the server, which is worse in every way than a setting somebody can read.
   *
   * With this off, sign-in is email and password only — one factor. That is a
   * real reduction, taken deliberately, and it is recorded here rather than
   * hidden in a working tree. Turn it back on the day a provider exists; the
   * check below makes sure nobody forgets.
   */
  OTP_REQUIRED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Docker-free development: leave REDIS_URL unset and the queue runs in
   * process. BullMQ takes over the moment a URL is present, with no code change.
   */
  REDIS_URL: z.string().optional(),
  QUEUE_DRIVER: z.enum(['memory', 'bullmq']).default('memory'),

  /** `local` writes to LOCAL_STORAGE_DIR; `s3` needs the S3_* block. */
  STORAGE_DRIVER: z.enum(['local', 's3', 'memory']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./var/files'),
  /** Only for an S3-compatible store such as MinIO. Leave unset for AWS. */
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  /** Everything this application writes sits under one prefix, so a bucket can be shared. */
  S3_PREFIX: z.string().optional(),
  S3_SSE: z.enum(['AES256', 'aws:kms']).optional(),
  S3_KMS_KEY_ID: z.string().optional(),
  /**
   * The fallback, not the plan. On EC2 leave both unset and attach an instance
   * role: a role rotates itself, and it cannot be pasted into a chat message.
   */
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  /**
   * `none` is the deployed setting. The client chose WhatsApp only, so nothing
   * should try to send email — and nothing should quietly write .eml files to
   * a server's disk either, which is what `console` would do there.
   */
  EMAIL_PROVIDER: z.enum(['none', 'console', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('UCF Tracker <no-reply@example.gov>'),
  EMAIL_OUTBOX_DIR: z.string().default('./var/mail'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  WHATSAPP_PROVIDER: z.enum(['console', 'gupshup']).default('console'),
  GUPSHUP_API_KEY: z.string().optional(),
  GUPSHUP_SOURCE: z.string().optional(),
  GUPSHUP_APP_NAME: z.string().optional(),
  WEBHOOK_HMAC_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Environment is not valid:\n${lines.join('\n')}\n\nSee .env.example.`);
  }
  const env = parsed.data;

  // Cross-field checks the schema cannot express on its own.
  if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
    throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET (and the rest of the S3_ block).');
  }
  if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_HOST) {
    throw new Error('EMAIL_PROVIDER=smtp requires SMTP_HOST.');
  }
  if (env.QUEUE_DRIVER === 'bullmq' && !env.REDIS_URL) {
    throw new Error('QUEUE_DRIVER=bullmq requires REDIS_URL.');
  }
  /*
   * OTP may only be off while there is genuinely no way to deliver the code.
   *
   * The moment a real provider is configured the reason for turning it off
   * has gone, and a second factor left switched off because nobody
   * remembered is exactly the kind of thing that is discovered during an
   * audit rather than before one. So the setting expires by itself: configure
   * SMTP or a WhatsApp aggregator and the application refuses to start until
   * OTP is turned back on.
   */
  if (!env.OTP_REQUIRED && (env.EMAIL_PROVIDER === 'smtp' || env.WHATSAPP_PROVIDER !== 'console')) {
    throw new Error(
      'OTP_REQUIRED=false is only defensible while no provider can deliver the code, and ' +
        `this deployment has one configured (EMAIL_PROVIDER=${env.EMAIL_PROVIDER}, ` +
        `WHATSAPP_PROVIDER=${env.WHATSAPP_PROVIDER}). Set OTP_REQUIRED=true.`,
    );
  }
  if (env.NODE_ENV === 'production') {
    if (env.EMAIL_PROVIDER === 'console') {
      throw new Error(
        'EMAIL_PROVIDER=console is a development-only sink — it writes .eml files to disk ' +
          'that nobody will ever read. Use EMAIL_PROVIDER=none (this deployment is ' +
          'WhatsApp-only) or configure smtp.',
      );
    }
    if (env.QUEUE_DRIVER === 'memory') {
      throw new Error(
        'QUEUE_DRIVER=memory loses queued messages on restart. Use bullmq in production.',
      );
    }
    /*
     * The box is disposable; the bucket is not. Uploaded sanction orders and
     * signed minutes on an instance's root volume are gone the first time that
     * instance is replaced, and nothing in the application would notice — the
     * database row would still be there, pointing at bytes that no longer
     * exist. That failure is silent for months and then total.
     */
    if (env.STORAGE_DRIVER !== 's3') {
      throw new Error(
        `STORAGE_DRIVER=${env.STORAGE_DRIVER} in production would put uploaded documents on ` +
          'the instance filesystem, which is replaced on every deployment. Use s3.',
      );
    }
  }
  return env;
}
