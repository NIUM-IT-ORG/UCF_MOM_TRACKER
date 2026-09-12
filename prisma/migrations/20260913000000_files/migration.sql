-- Phase 2 - files arrive after their row does.
--
-- A file is recorded in two steps: POST /files reserves the row and hands back
-- somewhere to put the bytes, then the bytes are uploaded. Between those two
-- the size and digest are not known yet, so they cannot be NOT NULL - and
-- `uploaded_at` is what distinguishes a finished file from a reservation that
-- was never completed.

ALTER TABLE "stored_files" ALTER COLUMN "size_bytes" DROP NOT NULL;
ALTER TABLE "stored_files" ALTER COLUMN "sha256"     DROP NOT NULL;
ALTER TABLE "stored_files" ADD COLUMN "uploaded_at" TIMESTAMP(3);

-- Everything already in the table came from the seed, complete.
UPDATE "stored_files" SET "uploaded_at" = "createdAt" WHERE "uploaded_at" IS NULL;

-- A document may only point at a file whose bytes actually arrived. Without
-- this, a failed upload still leaves a document row that downloads nothing.
CREATE INDEX "stored_files_uploaded_at_idx" ON "stored_files"("uploaded_at");
