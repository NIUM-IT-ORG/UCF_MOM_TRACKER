import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import type { SessionUser } from '@mom/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import { TokensService, hashToken } from './tokens.service.js';
import type { AuthUser } from './auth-user.js';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60_000;
const LOCKOUT_DURATION_MS = 15 * 60_000;

/** Argon2id, at the parameters OWASP currently recommends for interactive login. */
const ARGON = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface LoginResult {
  challengeId: string;
  /** Development only: the code, so the demo does not need a mail server. */
  devOtp?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: SessionUser;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly config: ConfigService,
  ) {}

  // ── password step ────────────────────────────────────────────────────

  async login(email: string, password: string, ip?: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        accountState: true,
        lockedUntil: true,
      },
    });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppError(
        'UNAUTHENTICATED',
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    }

    /*
     * Verify against a decoy hash when the account does not exist or cannot
     * sign in, so every path costs the same. Without this, response time tells
     * an attacker which addresses are real.
     */
    const hash = user?.passwordHash ?? DECOY_HASH;
    const ok = await argon2.verify(hash, password).catch(() => false);

    if (!user || !ok || user.accountState !== 'ACTIVE' || !user.passwordHash) {
      await this.recordAttempt(email, user?.id ?? null, false, ip);
      await this.lockIfNeeded(email, user?.id ?? null);
      // One message for every failure. Which half was wrong is not the
      // client's business, and saying so enumerates accounts.
      throw new AppError('UNAUTHENTICATED', 'Those sign-in details were not recognised.');
    }

    await this.recordAttempt(email, user.id, true, ip);

    // A fresh challenge supersedes any earlier one, so an abandoned attempt
    // cannot be completed later by someone who saw the code.
    await this.prisma.otpChallenge.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        userId: user.id,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
      select: { id: true },
    });

    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    if (!isProduction) {
      // Phase 5 delivers this by email and WhatsApp. Until then it goes to the
      // log, and to the response, so the demo is usable without a mail server.
      this.logger.log(`OTP for ${user.email}: ${code}`);
    }

    return { challengeId: challenge.id, devOtp: isProduction ? undefined : code };
  }

  // ── OTP step ─────────────────────────────────────────────────────────

  async verifyOtp(
    challengeId: string,
    otp: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<IssuedSession> {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: challengeId },
      select: { id: true, userId: true, codeHash: true, expiresAt: true, attempts: true, consumedAt: true },
    });

    const invalid = new AppError('UNAUTHENTICATED', 'That code is not valid. Start again.');
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) throw invalid;
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      throw invalid;
    }

    if (!equalHashes(sha256(otp), challenge.codeHash)) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError('UNAUTHENTICATED', 'That code is not correct.');
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    await this.prisma.user.update({
      where: { id: challenge.userId },
      data: { lastLoginAt: new Date(), lockedUntil: null },
    });

    return this.issue(challenge.userId, crypto.randomUUID(), meta);
  }

  // ── refresh, with rotation and reuse detection ────────────────────────

  async refresh(
    refreshToken: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<IssuedSession> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    const invalid = new AppError('UNAUTHENTICATED', 'Please sign in again.');
    if (!session) throw invalid;

    /*
     * The token exists but has already been rotated away or revoked. A valid
     * client never presents one twice, so this is a replay: the token leaked.
     * Revoke the entire family rather than this one row - the thief may already
     * hold a newer token from the same login.
     */
    if (session.revokedAt) {
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
      });
      await this.prisma.auditEntry.create({
        data: {
          actorId: session.userId,
          objectType: 'SESSION',
          objectId: session.id,
          objectRef: session.familyId,
          event: 'REFRESH_REUSE_DETECTED',
          detail: 'A rotated refresh token was presented again; the session family was revoked.',
          ipAddress: meta.ip ?? null,
        },
      });
      this.logger.warn(`Refresh token reuse on family ${session.familyId} - family revoked`);
      throw invalid;
    }

    if (session.expiresAt < new Date()) throw invalid;

    const issued = await this.issue(session.userId, session.familyId, meta);

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        revokedReason: 'ROTATED',
        lastUsedAt: new Date(),
        replacedById: issued.sessionId,
      },
    });

    return issued.session;
  }

  // ── sessions ─────────────────────────────────────────────────────────

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
    });
  }

  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.session.updateMany({
      // Scoped to the caller: you can only revoke your own sessions.
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'REVOKED_BY_USER' },
    });
    if (result.count === 0) throw AppError.notFound('That session');
  }

  // ── the resolved caller ──────────────────────────────────────────────

  /**
   * Capabilities and project scope, read fresh. This runs on every guarded
   * request; it is two joins on indexed columns, and it is what makes a
   * designation change take effect immediately.
   */
  async resolveUser(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        accountState: true,
        seesAllProjects: true,
        designation: { select: { code: true, name: true, caps: true } },
        projects: { select: { projectId: true } },
      },
    });
    /*
     * No email, no session. Email is the login identifier, so a person
     * without one cannot have signed in — and since external invitees are
     * exactly the people allowed to have no email, this is the line that
     * keeps "can be named in attendance" from ever becoming "can act". It is
     * a null return rather than a throw: to the caller this is simply not a
     * usable session, the same as a suspended account.
     */
    if (!user || user.accountState !== 'ACTIVE' || !user.email) return null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      designationCode: user.designation.code,
      designationName: user.designation.name,
      caps: user.designation.caps,
      projectIds: user.projects.map((p) => p.projectId),
      seesAllProjects: user.seesAllProjects,
    };
  }

  async sessionUser(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        initials: true,
        email: true,
        seesAllProjects: true,
        designation: { select: { code: true, name: true, band: true, caps: true } },
        department: { select: { id: true, name: true } },
        projects: {
          select: { project: { select: { id: true, code: true, name: true } } },
          orderBy: { project: { code: 'asc' } },
        },
      },
    });
    if (!user) throw AppError.notFound('That user');
    /*
     * Unreachable through the guard, which has already refused a session for
     * anyone without an email — but stated rather than asserted, because the
     * alternative is `user.email!` and a null quietly reaching the top bar.
     */
    if (!user.email) throw AppError.notFound('That user');

    return {
      id: user.id,
      name: user.name,
      initials: user.initials,
      email: user.email,
      designation: {
        code: user.designation.code,
        name: user.designation.name,
        band: user.designation.band,
      },
      department: user.department,
      caps: user.designation.caps,
      projectIds: user.projects.map((p) => p.project.id),
      projects: user.projects.map((p) => p.project),
      seesAllProjects: user.seesAllProjects,
    };
  }

  // ── internals ────────────────────────────────────────────────────────

  private async issue(
    userId: string,
    familyId: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<IssuedSession & { sessionId: string; session: IssuedSession }> {
    const { token, hash } = this.tokens.newRefreshToken();
    const expiresAt = new Date(Date.now() + this.tokens.refreshTtlMs());

    const session = await this.prisma.session.create({
      data: {
        userId,
        familyId,
        tokenHash: hash,
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 400) ?? null,
        ipAddress: meta.ip ?? null,
        lastUsedAt: new Date(),
      },
      select: { id: true },
    });

    const issued: IssuedSession = {
      accessToken: this.tokens.signAccess(userId, session.id),
      refreshToken: token,
      refreshExpiresAt: expiresAt,
      user: await this.sessionUser(userId),
    };
    return { ...issued, sessionId: session.id, session: issued };
  }

  private async recordAttempt(
    email: string,
    userId: string | null,
    succeeded: boolean,
    ip?: string,
  ): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: { email: email.toLowerCase(), userId, succeeded, ipAddress: ip ?? null },
    });
  }

  /** Five failures inside the window locks the account, and says so in the audit. */
  private async lockIfNeeded(email: string, userId: string | null): Promise<void> {
    if (!userId) return;
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
    const failures = await this.prisma.loginAttempt.count({
      where: { email: email.toLowerCase(), succeeded: false, createdAt: { gte: since } },
    });
    if (failures < LOCKOUT_THRESHOLD) return;

    const until = new Date(Date.now() + LOCKOUT_DURATION_MS);
    await this.prisma.user.update({ where: { id: userId }, data: { lockedUntil: until } });
    await this.prisma.auditEntry.create({
      data: {
        actorId: null,
        objectType: 'USER',
        objectId: userId,
        objectRef: email,
        event: 'ACCOUNT_LOCKED',
        detail: `${failures} failed sign-in attempts within 15 minutes.`,
      },
    });
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison, so a wrong code cannot be found a digit at a time. */
function equalHashes(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * A real Argon2id hash of a value nobody knows, verified against when the
 * account does not exist. It makes the unknown-account path cost the same as
 * the wrong-password path.
 */
const DECOY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$Yy7gKb5Gzr/rP0kHcVQGS3FtyLZG1ZQhKZ3o3KpWDnI';

export const ARGON_OPTIONS = ARGON;

export async function hashPassword(password: string): Promise<string> {
  // argon2.hash is overloaded and its Buffer-returning signature wins type
  // inference here; the string form is what runs without `raw: true`.
  return argon2.hash(password, ARGON) as unknown as Promise<string>;
}
