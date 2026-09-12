-- Phase 1 - authentication.
--
-- Three tables and one column, all of them about proving who is asking.
-- Nothing here stores a secret in the clear: passwords are Argon2id hashes on
-- users, refresh tokens are stored as SHA-256 digests, and OTP codes likewise.

-- Locked until this instant after repeated failed sign-ins (docs/04-RBAC.md 6).
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMP(3);

-- One row per refresh token ever issued. Rotation writes a new row and marks
-- the old one replaced, which is what makes a replay detectable: presenting a
-- token that has already been rotated away means it leaked, so the whole
-- family is revoked rather than just that one token.
CREATE TABLE "sessions" (
  "id"              TEXT PRIMARY KEY,
  "user_id"         TEXT NOT NULL,
  "family_id"       TEXT NOT NULL,
  "token_hash"      TEXT NOT NULL,
  "user_agent"      TEXT,
  "ip_address"      TEXT,
  "expires_at"      TIMESTAMP(3) NOT NULL,
  "revoked_at"      TIMESTAMP(3),
  "revoked_reason"  TEXT,
  "replaced_by_id"  TEXT,
  "last_used_at"    TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_idx"   ON "sessions"("user_id");
CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A one-time code issued after the password step: short-lived, single-use and
-- attempt-limited, so a six-digit code cannot be brute-forced.
CREATE TABLE "otp_challenges" (
  "id"          TEXT PRIMARY KEY,
  "user_id"     TEXT NOT NULL,
  "code_hash"   TEXT NOT NULL,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "otp_challenges_user_id_idx" ON "otp_challenges"("user_id");

ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Failed sign-ins, for the five-strikes lockout. Recorded against the email
-- rather than the user, so attempts on an address that does not exist are
-- counted too and cannot be used to enumerate accounts by timing.
CREATE TABLE "login_attempts" (
  "id"         TEXT PRIMARY KEY,
  "email"      TEXT NOT NULL,
  "user_id"    TEXT,
  "succeeded"  BOOLEAN NOT NULL,
  "ip_address" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "login_attempts_email_createdAt_idx" ON "login_attempts"("email", "createdAt");
