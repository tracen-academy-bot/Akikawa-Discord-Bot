-- First-finder overrides: who found a special first, kept when their finds are removed.
CREATE TABLE "TimerFirstFinder" (
    "guildId" TEXT NOT NULL,
    "specialId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimerFirstFinder_pkey" PRIMARY KEY ("guildId","specialId")
);

-- Tylina's Grandmother reset (owner, 2026-11-15), in every guild: keep her
-- earliest find as the first-finder override, then remove all her finds of
-- Grandmother, so she meets Grandmother again. Mirrored by `resetFinds` in
-- src/lib/timer/rares.ts (tested there).
INSERT INTO "TimerFirstFinder" ("guildId", "specialId", "discordUserId", "at")
SELECT DISTINCT ON ("guildId") "guildId", "specialId", "discordUserId", "at"
FROM "RareOpenerHit"
WHERE "discordUserId" = '457773317739380738' AND "specialId" = 'mejiro.grandmother'
ORDER BY "guildId", "at" ASC
ON CONFLICT ("guildId", "specialId") DO NOTHING;

DELETE FROM "RareOpenerHit"
WHERE "discordUserId" = '457773317739380738' AND "specialId" = 'mejiro.grandmother';
