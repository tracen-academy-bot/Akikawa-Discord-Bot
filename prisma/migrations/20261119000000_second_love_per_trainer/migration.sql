-- Who has earned "Ramonu's Second Love", per trainer (owner, 2026-11-19):
-- the Remedial Rehearsal is done for auto-off only once it is earned.
ALTER TABLE "TimerUserSettings" ADD COLUMN "secondLove" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: each guild's first winner (the only per-trainer record so far).
INSERT INTO "TimerUserSettings" ("guildId", "discordUserId", "secondLove", "updatedAt")
SELECT "guildId", "firstUserId", true, NOW() FROM "TimerSecondLove"
ON CONFLICT ("guildId", "discordUserId") DO UPDATE SET "secondLove" = true;
