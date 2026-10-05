-- B is no longer an expected rank (the club asked for it removed on
-- 2026-10-05). Postgres cannot drop an enum value, so the type is rebuilt
-- without it. A club set to B, if any, becomes unset, to be picked again.

-- All or nothing: a failure part-way leaves the data exactly as it was.
BEGIN;

UPDATE "TrackedCircle" SET "rank" = NULL WHERE "rank" = 'B';

-- The pre-merge backup table also uses the type. Its ranks become plain text
-- so the backup keeps them exactly, B included.
DO $$
BEGIN
    IF to_regclass('public."Club_backup_20261004"') IS NOT NULL THEN
        ALTER TABLE "Club_backup_20261004" ALTER COLUMN "rank" TYPE TEXT USING "rank"::TEXT;
    END IF;
END $$;

ALTER TYPE "ClubRank" RENAME TO "ClubRank_old";
CREATE TYPE "ClubRank" AS ENUM ('CASUAL', 'B_PLUS', 'A', 'A_PLUS', 'S', 'S_PLUS');
ALTER TABLE "TrackedCircle" ALTER COLUMN "rank" TYPE "ClubRank" USING ("rank"::TEXT::"ClubRank");
DROP TYPE "ClubRank_old";

COMMIT;
