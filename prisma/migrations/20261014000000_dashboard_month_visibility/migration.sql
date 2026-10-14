-- Which months' actions the dashboard counts.
--
-- A year of conducted meetings leaves the dashboard describing mostly
-- history. The System Administrator can now switch a month off, and the
-- actions and clarifications raised in that month's meetings stop counting
-- towards every figure on that page.
--
-- Nothing is deleted and nothing moves. The register, the reports, the
-- meeting itself and the MoM are untouched - this is a reporting window, not
-- an archive, and an item hidden here is still open, still assigned and
-- still in the register.
--
-- A row exists only for a month somebody has configured. Absent means
-- enabled, which is what makes a new month appear on the dashboard the moment
-- its first meeting is held, with no administrator having to remember to
-- switch it on.
--
-- The month is the meeting's month, as "2026-09" - the month the commitment
-- was made in, which never changes once minuted. CHAR(7) with a CHECK rather
-- than a date, because this is a label for a whole month and storing the
-- first of it invites somebody to compare it against a timestamp.
--
-- ASCII and idempotent, in the house style: this has to apply to a WIN1252
-- cluster and survive a re-run.

CREATE TABLE IF NOT EXISTS "dashboard_months" (
  "month"         CHAR(7)      NOT NULL,
  "enabled"       BOOLEAN      NOT NULL DEFAULT true,
  "updated_by_id" TEXT,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dashboard_months_pkey" PRIMARY KEY ("month"),
  CONSTRAINT "dashboard_months_month_format" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

-- No cascade: who set it is part of the record, and the record outlives the
-- account. The same reasoning as the audit trail's actor.
DO $$
BEGIN
  ALTER TABLE "dashboard_months"
    ADD CONSTRAINT "dashboard_months_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
