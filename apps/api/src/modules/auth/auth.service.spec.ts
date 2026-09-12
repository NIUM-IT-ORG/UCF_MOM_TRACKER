import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService, hashPassword } from './auth.service.js';
import { TokensService, hashToken } from './tokens.service.js';
import { AppError } from '../../common/app-error.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

/**
 * A Prisma stand-in holding rows in memory.
 *
 * The Prisma engine binary cannot be downloaded in this environment, so these
 * exercise the decisions - lockout, rotation, reuse, single-use codes - rather
 * than the SQL. The SQL is covered by the migration and seed assertions, and by
 * the API tests CI runs against a real database.
 */
interface Row {
  [key: string]: unknown;
}

function makeFakePrisma() {
  const users: Row[] = [];
  const otps: Row[] = [];
  const sessions: Row[] = [];
  const attempts: Row[] = [];
  const audits: Row[] = [];
  let seq = 0;
  const nextId = () => `id${(seq += 1)}`;

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v === null) return row[k] === null || row[k] === undefined;
      if (v && typeof v === 'object' && 'gte' in (v as Row)) {
        return (row[k] as Date) >= ((v as Row).gte as Date);
      }
      return row[k] === v;
    });

  const table = (rows: Row[]) => ({
    findUnique: ({ where }: { where: Row }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    findFirst: ({ where }: { where: Row }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    findMany: ({ where }: { where?: Row } = {}) =>
      Promise.resolve(where ? rows.filter((r) => matches(r, where)) : [...rows]),
    count: ({ where }: { where?: Row } = {}) =>
      Promise.resolve(where ? rows.filter((r) => matches(r, where)).length : rows.length),
    create: ({ data }: { data: Row }) => {
      const row: Row = { id: nextId(), createdAt: new Date(), ...data };
      // Prisma's `{ increment: n }` never reaches create; defaults do.
      rows.push(row);
      return Promise.resolve(row);
    },
    update: ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('no such row');
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && 'increment' in (v as Row)) {
          row[k] = ((row[k] as number) ?? 0) + ((v as Row).increment as number);
        } else {
          row[k] = v;
        }
      }
      return Promise.resolve(row);
    },
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      const found = rows.filter((r) => matches(r, where));
      for (const row of found) Object.assign(row, data);
      return Promise.resolve({ count: found.length });
    },
  });

  return {
    _rows: { users, otps, sessions, attempts, audits },
    user: table(users),
    otpChallenge: table(otps),
    session: table(sessions),
    loginAttempt: table(attempts),
    auditEntry: table(audits),
  };
}

function makeService(fake: ReturnType<typeof makeFakePrisma>) {
  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'test_access_secret_at_least_16',
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL: '7d',
    NODE_ENV: 'test',
  });
  const tokens = new TokensService(config);
  const prisma = fake as unknown as PrismaService;
  return { service: new AuthService(prisma, tokens, config), tokens };
}

const PASSWORD = 'correct horse battery staple';

describe('AuthService', () => {
  let fake: ReturnType<typeof makeFakePrisma>;
  let service: AuthService;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ service } = makeService(fake));

    fake._rows.users.push({
      id: 'u1',
      name: 'Officer A',
      initials: 'OA',
      email: 'officer.a@example.gov',
      passwordHash: await hashPassword(PASSWORD),
      accountState: 'ACTIVE',
      lockedUntil: null,
      seesAllProjects: true,
      designation: { code: 'MD', name: 'Mission Director', band: 'Executive', caps: ['approve_mom'] },
      department: { id: 'd1', name: 'UCF Head Office' },
      projects: [],
    });
  });

  describe('password step', () => {
    it('issues a challenge for the right password', async () => {
      const result = await service.login('officer.a@example.gov', PASSWORD);
      expect(result.challengeId).toBeTruthy();
      expect(result.devOtp).toMatch(/^\d{6}$/);
    });

    it('refuses the wrong password', async () => {
      await expect(service.login('officer.a@example.gov', 'wrong')).rejects.toThrowError(AppError);
    });

    it('gives an unknown address the same answer as a wrong password', async () => {
      const a = await service.login('officer.a@example.gov', 'wrong').catch((e: AppError) => e);
      const b = await service.login('nobody@example.gov', 'wrong').catch((e: AppError) => e);
      // Identical wording, so the response cannot be used to enumerate accounts.
      expect((a as AppError).message).toBe((b as AppError).message);
    });

    it('refuses an invite-only account that has no password', async () => {
      fake._rows.users.push({
        id: 'u13',
        email: 'banker.1@example.gov',
        passwordHash: null,
        accountState: 'INVITE_ONLY',
        lockedUntil: null,
      });
      await expect(service.login('banker.1@example.gov', PASSWORD)).rejects.toThrowError(AppError);
    });

    it('locks the account after five failures, and says when it unlocks', async () => {
      for (let i = 0; i < 5; i += 1) {
        await service.login('officer.a@example.gov', 'wrong').catch(() => undefined);
      }
      const user = fake._rows.users[0] as Row;
      expect(user.lockedUntil).toBeInstanceOf(Date);

      // Even the correct password is refused while locked.
      const err = await service.login('officer.a@example.gov', PASSWORD).catch((e: AppError) => e);
      expect((err as AppError).message).toMatch(/Try again in \d+ minute/);

      // And the lock is on the record, not only in memory.
      expect(fake._rows.audits.some((a) => a.event === 'ACCOUNT_LOCKED')).toBe(true);
    });

    it('supersedes an earlier unfinished challenge', async () => {
      const first = await service.login('officer.a@example.gov', PASSWORD);
      await service.login('officer.a@example.gov', PASSWORD);
      const stale = fake._rows.otps.find((o) => o.id === first.challengeId) as Row;
      expect(stale.consumedAt).toBeTruthy();
    });
  });

  describe('OTP step', () => {
    it('exchanges a correct code for a session', async () => {
      const { challengeId, devOtp } = await service.login('officer.a@example.gov', PASSWORD);
      const issued = await service.verifyOtp(challengeId, devOtp!, {});
      expect(issued.accessToken).toBeTruthy();
      expect(issued.refreshToken).toBeTruthy();
      expect(issued.user.designation.code).toBe('MD');
    });

    it('refuses a wrong code and counts the attempt', async () => {
      const { challengeId } = await service.login('officer.a@example.gov', PASSWORD);
      await expect(service.verifyOtp(challengeId, '000000', {})).rejects.toThrowError(AppError);
      const challenge = fake._rows.otps.find((o) => o.id === challengeId) as Row;
      expect(challenge.attempts).toBe(1);
    });

    it('will not accept the same code twice', async () => {
      const { challengeId, devOtp } = await service.login('officer.a@example.gov', PASSWORD);
      await service.verifyOtp(challengeId, devOtp!, {});
      await expect(service.verifyOtp(challengeId, devOtp!, {})).rejects.toThrowError(AppError);
    });

    it('refuses an expired code', async () => {
      const { challengeId, devOtp } = await service.login('officer.a@example.gov', PASSWORD);
      const challenge = fake._rows.otps.find((o) => o.id === challengeId) as Row;
      challenge.expiresAt = new Date(Date.now() - 1000);
      await expect(service.verifyOtp(challengeId, devOtp!, {})).rejects.toThrowError(AppError);
    });

    it('gives up after five wrong codes rather than allowing a brute force', async () => {
      const { challengeId, devOtp } = await service.login('officer.a@example.gov', PASSWORD);
      for (let i = 0; i < 5; i += 1) {
        await service.verifyOtp(challengeId, '000000', {}).catch(() => undefined);
      }
      // Even the right code no longer works.
      await expect(service.verifyOtp(challengeId, devOtp!, {})).rejects.toThrowError(AppError);
    });
  });

  describe('refresh rotation', () => {
    async function signIn() {
      const { challengeId, devOtp } = await service.login('officer.a@example.gov', PASSWORD);
      return service.verifyOtp(challengeId, devOtp!, {});
    }

    it('swaps the refresh token for a new one', async () => {
      const first = await signIn();
      const second = await service.refresh(first.refreshToken, {});
      expect(second.refreshToken).not.toBe(first.refreshToken);

      const oldRow = fake._rows.sessions.find(
        (s) => s.tokenHash === hashToken(first.refreshToken),
      ) as Row;
      expect(oldRow.revokedReason).toBe('ROTATED');
      expect(oldRow.replacedById).toBeTruthy();
    });

    it('detects a replay and kills the whole family', async () => {
      const first = await signIn();
      await service.refresh(first.refreshToken, {});

      // The old token turns up again: it leaked.
      await expect(service.refresh(first.refreshToken, {})).rejects.toThrowError(AppError);

      const live = fake._rows.sessions.filter((s) => !s.revokedAt);
      expect(live, 'every token in the family should be revoked').toHaveLength(0);
      expect(fake._rows.audits.some((a) => a.event === 'REFRESH_REUSE_DETECTED')).toBe(true);
    });

    it('refuses an unknown token', async () => {
      await expect(service.refresh('not-a-real-token', {})).rejects.toThrowError(AppError);
    });

    it('refuses an expired one', async () => {
      const first = await signIn();
      const row = fake._rows.sessions.find(
        (s) => s.tokenHash === hashToken(first.refreshToken),
      ) as Row;
      row.expiresAt = new Date(Date.now() - 1000);
      await expect(service.refresh(first.refreshToken, {})).rejects.toThrowError(AppError);
    });

    it('stores only the digest, never the token', async () => {
      const first = await signIn();
      const stored = fake._rows.sessions.map((s) => JSON.stringify(s)).join(' ');
      expect(stored).not.toContain(first.refreshToken);
      expect(stored).toContain(createHash('sha256').update(first.refreshToken).digest('hex'));
    });
  });

  describe('resolveUser - the guard reads this on every request', () => {
    it('returns the designation capabilities of the moment', async () => {
      const before = await service.resolveUser('u1');
      expect(before?.caps).toEqual(['approve_mom']);

      // An administrator edits the designation.
      (fake._rows.users[0] as Row).designation = {
        code: 'MD',
        name: 'Mission Director',
        band: 'Executive',
        caps: [],
      };

      const after = await service.resolveUser('u1');
      expect(after?.caps, 'revoked without a re-login').toEqual([]);
    });

    it('refuses a suspended account even with a valid token', async () => {
      (fake._rows.users[0] as Row).accountState = 'SUSPENDED';
      expect(await service.resolveUser('u1')).toBeNull();
    });
  });
});

describe('password hashing', () => {
  it('uses argon2id and verifies', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(hash, PASSWORD)).toBe(true);
    expect(await argon2.verify(hash, 'something else')).toBe(false);
  });
});
