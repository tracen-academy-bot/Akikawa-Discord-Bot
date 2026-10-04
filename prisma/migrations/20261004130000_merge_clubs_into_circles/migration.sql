-- Clubs and tracked circles become one table: a club's info (rank, headcount,
-- fan count, staff) moves onto its TrackedCircle row, and a club with no
-- uma.moe circle gets a row of its own with "circleId" NULL. Approved by the
-- club on 2026-10-04.
--
-- Nothing is deleted. The old "Club" table is renamed to
-- "Club_backup_20261004" and left in place, so the move can be checked or
-- undone by hand; a later migration can drop it.

-- All or nothing: a failure part-way leaves the data exactly as it was.
BEGIN;

-- 1. Club columns on TrackedCircle. "clubId" stays until the data has moved.
ALTER TABLE "TrackedCircle"
ADD COLUMN     "fanCountAmount" DOUBLE PRECISION,
ADD COLUMN     "fanCountPeriod" "FanCountPeriod",
ADD COLUMN     "headcount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "homeChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rank" "ClubRank",
ALTER COLUMN "circleId" DROP NOT NULL;

-- 2. Which row each club becomes.
CREATE TEMP TABLE "_club_target" ("clubId" TEXT PRIMARY KEY, "rowId" TEXT);

--    a) The circle already linked to it (the oldest, if several were).
INSERT INTO "_club_target" ("clubId", "rowId")
SELECT c."id",
       (SELECT t."id" FROM "TrackedCircle" t WHERE t."clubId" = c."id" ORDER BY t."createdAt", t."id" LIMIT 1)
FROM "Club" c;

--    b) Otherwise the one circle with the same name, ignoring case, if exactly
--       one has it and no other club already claimed it.
WITH named AS (
    SELECT m."clubId", min(t."id") AS "rowId", count(*) AS n
    FROM "_club_target" m
    JOIN "Club" c ON c."id" = m."clubId"
    JOIN "TrackedCircle" t ON lower(t."name") = lower(c."name")
    WHERE m."rowId" IS NULL
    GROUP BY m."clubId"
)
UPDATE "_club_target" m
SET "rowId" = named."rowId"
FROM named
WHERE named."clubId" = m."clubId"
  AND named.n = 1
  AND NOT EXISTS (SELECT 1 FROM "_club_target" o WHERE o."rowId" = named."rowId");

--    c) Otherwise a new row of its own, reusing the club's id. Its guild is
--       the one the existing circles belong to (the bot serves one server).
INSERT INTO "TrackedCircle" ("id", "guildId", "circleId", "name", "createdAt", "updatedAt")
SELECT c."id",
       COALESCE((SELECT t."guildId" FROM "TrackedCircle" t ORDER BY t."createdAt", t."id" LIMIT 1), ''),
       NULL,
       c."name",
       c."createdAt",
       CURRENT_TIMESTAMP
FROM "Club" c
JOIN "_club_target" m ON m."clubId" = c."id"
WHERE m."rowId" IS NULL;

UPDATE "_club_target" SET "rowId" = "clubId" WHERE "rowId" IS NULL;

-- 3. Copy the club info. If two clubs landed on one row, the oldest wins.
UPDATE "TrackedCircle" t
SET "rank" = src."rank",
    "headcount" = src."headcount",
    "fanCountAmount" = src."fanCountAmount",
    "fanCountPeriod" = src."fanCountPeriod"
FROM (
    SELECT DISTINCT ON (m."rowId") m."rowId", c."rank", c."headcount", c."fanCountAmount", c."fanCountPeriod"
    FROM "_club_target" m
    JOIN "Club" c ON c."id" = m."clubId"
    ORDER BY m."rowId", c."createdAt", c."id"
) src
WHERE t."id" = src."rowId";

-- 4. Staff now belong to the row. Drop the old foreign key, remove anyone
--    who would appear twice on one row (two clubs merged), then repoint.
ALTER TABLE "ClubMember" DROP CONSTRAINT "ClubMember_clubId_fkey";

DELETE FROM "ClubMember" a
USING "ClubMember" b, "_club_target" ma, "_club_target" mb
WHERE ma."clubId" = a."clubId"
  AND mb."clubId" = b."clubId"
  AND ma."rowId" = mb."rowId"
  AND a."discordUserId" = b."discordUserId"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

UPDATE "ClubMember" cm
SET "clubId" = m."rowId"
FROM "_club_target" m
WHERE m."clubId" = cm."clubId";

ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "TrackedCircle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Retire the link and keep the old table as a backup.
ALTER TABLE "TrackedCircle" DROP CONSTRAINT "TrackedCircle_clubId_fkey";
ALTER TABLE "TrackedCircle" DROP COLUMN "clubId";

ALTER TABLE "Club" RENAME TO "Club_backup_20261004";
ALTER INDEX "Club_pkey" RENAME TO "Club_backup_20261004_pkey";
ALTER INDEX "Club_name_key" RENAME TO "Club_backup_20261004_name_key";

DROP TABLE "_club_target";

COMMIT;
