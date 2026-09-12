-- Phase 4 - a circulated MoM is immutable, so a correction is a new row.
--
-- docs/05-WORKFLOWS.md section 3: "A SIGNED MoM is immutable. A correction
-- creates a new MoM row with correctsMomId pointing at the original, going
-- through the same cycle. Never mutate a circulated MoM."
--
-- The original schema made meeting_id UNIQUE, which made that impossible: a
-- corrigendum would have had to overwrite the document people had already read,
-- filed and acted on. One MoM per meeting per version is the correct shape.

-- The unique index came from "moms_meeting_id_key"; a plain index replaces it,
-- because every lookup is still by meeting.
DROP INDEX IF EXISTS "moms_meeting_id_key";
CREATE INDEX IF NOT EXISTS "moms_meeting_id_idx" ON "moms"("meeting_id");

-- Two rows for one meeting must still differ by version, or "the current MoM"
-- has no answer.
CREATE UNIQUE INDEX IF NOT EXISTS "moms_meeting_id_version_key" ON "moms"("meeting_id", "version");

-- corrects_mom_id already exists as a column; it was never a foreign key, so a
-- corrigendum could point at a MoM that no longer existed.
ALTER TABLE "moms"
  DROP CONSTRAINT IF EXISTS "moms_corrects_mom_id_fkey";
ALTER TABLE "moms"
  ADD CONSTRAINT "moms_corrects_mom_id_fkey"
  FOREIGN KEY ("corrects_mom_id") REFERENCES "moms"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;
