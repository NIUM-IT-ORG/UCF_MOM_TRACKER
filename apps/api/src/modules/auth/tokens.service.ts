import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { AppError } from '../../common/app-error.js';

export interface AccessClaims {
  sub: string;
  sid: string;
}

/**
 * Issues and verifies tokens.
 *
 * The access token carries an id and nothing else — no capabilities, no
 * project list. Putting permissions in a token means a fifteen-minute window
 * where a revoked officer still has their old powers; resolving them per
 * request costs one indexed query and removes the window entirely.
 *
 * The refresh token is opaque random bytes, not a JWT. Only its SHA-256 digest
 * is stored, so a database leak does not hand anyone a working session.
 */
@Injectable()
export class TokensService {
  constructor(private readonly config: ConfigService) {}

  private get accessSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  signAccess(userId: string, sessionId: string): string {
    return jwt.sign({ sub: userId, sid: sessionId }, this.accessSecret, {
      expiresIn: this.config.get<string>('ACCESS_TOKEN_TTL') ?? '15m',
    } as jwt.SignOptions);
  }

  verifyAccess(token: string): AccessClaims {
    try {
      const payload = jwt.verify(token, this.accessSecret);
      if (typeof payload === 'string' || !payload.sub || typeof payload.sub !== 'string') {
        throw new Error('malformed');
      }
      const sid = (payload as jwt.JwtPayload & { sid?: unknown }).sid;
      if (typeof sid !== 'string') throw new Error('malformed');
      return { sub: payload.sub, sid };
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    }
  }

  /** A refresh token and the digest to store for it. The token is never stored. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: hashToken(token) };
  }

  refreshTtlMs(): number {
    return parseDuration(this.config.get<string>('REFRESH_TOKEN_TTL') ?? '7d');
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** '7d', '15m', '30s' → milliseconds. */
export function parseDuration(value: string): number {
  const m = /^(\d+)([smhd])$/.exec(value.trim());
  if (!m || !m[1] || !m[2]) throw new Error(`Not a duration: "${value}"`);
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  if (unit === undefined) throw new Error(`Not a duration: "${value}"`);
  return n * unit;
}
