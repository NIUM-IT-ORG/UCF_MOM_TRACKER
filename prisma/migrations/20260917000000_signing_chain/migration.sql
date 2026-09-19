-- The signing chain.
--
-- Meeting Coordinator records and submits → Project Coordinator validates,
-- approves, and chooses whether the Additional Mission Director or the Mission
-- Director signs → that officer, and nobody else, signs in the system.
--
-- Two things change for data that already exists, so both are written as
-- idempotent statements scoped by designation CODE rather than by name: a
-- System Administrator may have renamed a designation at runtime, and the code
-- is the stable identity.

-- ─────────────────────────── the MoM row ───────────────────────────
-- Who was routed to sign, who signed, and exactly when. `signed_at` is what
-- the document prints beside the green tick, so it is recorded at the moment
-- of signing and never derived afterwards from `circulated_at`.
ALTER TABLE "moms" ADD COLUMN IF NOT EXISTS "signatory_id" TEXT;
ALTER TABLE "moms" ADD COLUMN IF NOT EXISTS "signed_by_id"  TEXT;
ALTER TABLE "moms" ADD COLUMN IF NOT EXISTS "signed_at"     TIMESTAMP(3);

-- A MoM already circulated before this migration has no signatory recorded,
-- because at the time there was no such step. Backfill from who uploaded the
-- signed copy: that is the closest true statement available, and leaving it
-- null would print a signed document with no name against the tick.
UPDATE "moms"
   SET "signed_by_id" = "signed_uploaded_by_id",
       "signatory_id" = "signed_uploaded_by_id",
       "signed_at"    = COALESCE("signed_uploaded_at", "circulated_at")
 WHERE "state" = 'SIGNED'
   AND "signed_by_id" IS NULL;

CREATE INDEX IF NOT EXISTS "moms_signatory_id_idx" ON "moms" ("signatory_id");

-- ─────────────────────── Project Director → Project Coordinator ───────────────────────
-- The same office and the same people; the official title was wrong.
UPDATE "designations"
   SET "name" = 'Project Coordinator', "updatedAt" = NOW()
 WHERE "code" = 'PD' AND "name" = 'Project Director';

-- ─────────────────────────── who approves, who signs ───────────────────────────
-- Validation and approval move to the Project Coordinator.
UPDATE "designations"
   SET "caps" = array_append("caps", 'approve_mom'), "updatedAt" = NOW()
 WHERE "code" = 'PD' AND NOT ('approve_mom' = ANY("caps"));

-- Executive leadership signs rather than approves. Removing approve_mom here
-- is the point of the change, not a side effect: if the Mission Director could
-- still approve, the routing step would be advisory and the chain would not
-- mean anything.
--
-- Note for whoever runs this: a MoM sitting in SUBMITTED at this moment now
-- waits for the Project Coordinator instead of the Mission Director. That is
-- intended. Nothing is stuck — it is simply with a different officer.
UPDATE "designations"
   SET "caps" = array_remove("caps", 'approve_mom'), "updatedAt" = NOW()
 WHERE "code" IN ('MD', 'AMD');

UPDATE "designations"
   SET "caps" = array_append("caps", 'sign_mom'), "updatedAt" = NOW()
 WHERE "code" IN ('MD', 'AMD') AND NOT ('sign_mom' = ANY("caps"));

-- Foreign keys for the two new officer columns.
--
-- Added after the backfill above, so the backfilled rows are checked by them
-- rather than slipping in ahead of the constraint. ON DELETE SET NULL, not
-- CASCADE: retiring an officer must never delete a signed minute, and RESTRICT
-- would make retiring them impossible. The name on a circulated MoM is also
-- printed into the document, so the record survives the column being cleared.
ALTER TABLE "moms" DROP CONSTRAINT IF EXISTS "moms_signatory_id_fkey";
ALTER TABLE "moms" ADD CONSTRAINT "moms_signatory_id_fkey"
  FOREIGN KEY ("signatory_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "moms" DROP CONSTRAINT IF EXISTS "moms_signed_by_id_fkey";
ALTER TABLE "moms" ADD CONSTRAINT "moms_signed_by_id_fkey"
  FOREIGN KEY ("signed_by_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL;
