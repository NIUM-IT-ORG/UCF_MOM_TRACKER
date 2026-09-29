-- Grant delete_meeting to the System Administrator on an existing database.
--
-- Capability grants live in designations.caps, not in the code. The seed
-- constant in packages/shared/capabilities.ts is the starting state for a
-- FRESH database: prisma/seed.ts only INSERTs, so a database that already
-- exists never learns about a capability added later.
--
-- Normally that is what the runtime matrix editor is for -- docs/04-RBAC.md:
-- "After go-live the matrix is editable at runtime". It is not built. The
-- route exists (PUT /access/matrix/:code, manage_access) but /access is still
-- a placeholder, so there is no screen on which to tick the box. Until that
-- screen exists, a migration is the only reviewable way to ship a new
-- capability to a running system; the alternative is SQL typed into a
-- production console, which is worse in every way.
--
-- Idempotent by construction: the WHERE clause means re-running changes
-- nothing, and a database that already has the grant is left alone.

UPDATE designations
   SET caps = array_append(caps, 'delete_meeting'),
       "updatedAt" = NOW()
 WHERE code = 'SYS'
   AND NOT ('delete_meeting' = ANY (caps));
