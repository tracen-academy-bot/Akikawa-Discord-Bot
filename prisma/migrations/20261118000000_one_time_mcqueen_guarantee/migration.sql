-- One-time McQueen (owner, 2026-11-18): trainer 801847462209126411 gets
-- Mejiro McQueen on their next possible ping, through the usual guarantee
-- (`guaranteedSpecialId` + `guaranteedInRuns`), in every guild where they
-- have a run or a timer. Only where no guarantee is pending (a Rehearsal
-- owed is never overwritten). The guarantee waits while McQueen is still
-- closed for them (Grandmother not found) or the Mejiro Estate is locked,
-- off or paused (`guaranteedOpener`). Tested in scripts/test-scheduler.ts.
INSERT INTO "TimerUserSettings" ("guildId", "discordUserId", "guaranteedSpecialId", "guaranteedInRuns", "updatedAt")
SELECT DISTINCT g."guildId", '801847462209126411', 'mejiro.mcqueen', 1, NOW()
FROM (
    SELECT "guildId" FROM "TrainingRun" WHERE "discordUserId" = '801847462209126411'
    UNION
    SELECT "guildId" FROM "TrainingTimer" WHERE "discordUserId" = '801847462209126411'
) AS g
ON CONFLICT ("guildId", "discordUserId") DO UPDATE
SET "guaranteedSpecialId" = 'mejiro.mcqueen', "guaranteedInRuns" = 1, "updatedAt" = NOW()
WHERE "TimerUserSettings"."guaranteedSpecialId" IS NULL;
