-- External invitees - docs/01-PRD.md section 3, the EXT designation.
--
-- "External invitee | Bankers, corporation engineers | Receive notifications,
-- be named in attendance. No login." The role has been in the specification
-- and in the RBAC matrix (EXT, with no capabilities) since the start; what was
-- missing was any way to record one, because users.email and users.mobile were
-- both NOT NULL and a banker added to a meeting on the morning of it has
-- frequently given neither.
--
-- Three changes, all widening: nothing existing becomes invalid.
--
--   email   nullable. It is the login identifier, so only a person who does
--           not sign in may be without one. That rule is enforced in the DTO,
--           not here - the database cannot see which designation is being
--           written in the same statement, and a CHECK that guessed would
--           block a legitimate correction. Postgres allows many NULLs under a
--           unique index, so uniqueness still holds for everyone who has one.
--
--   mobile  nullable, same reason.
--
--   title   the designation as typed, printed in place of the designation for
--           a person who does not sign in. An external is "Branch Manager,
--           SBI" on the attendance sheet, not "External invitee". Capability
--           still comes from designation_id, which still points at a real
--           designation row - a typed string has no answer to "what may this
--           person do?", and the access layer must always have one.
--
-- Written ASCII and idempotent, in the house style: this has to apply to a
-- WIN1252 cluster and to re-run without complaint.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "mobile" DROP NOT NULL;
