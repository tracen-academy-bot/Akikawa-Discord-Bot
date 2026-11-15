-- Special outcomes (Ramonu's Remedial Rehearsal): boosts on one special or a
-- whole set, a trainer's guaranteed next special and losing streak, and the
-- guild's "Ramonu's Second Love" role.
ALTER TABLE "TimerSpecialBoost" ADD COLUMN "key" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TimerSpecialBoost" ADD COLUMN "specialId" TEXT;
ALTER TABLE "TimerSpecialBoost" ADD COLUMN "chance" DOUBLE PRECISION;
ALTER TABLE "TimerSpecialBoost" ADD COLUMN "endsOnHit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TimerSpecialBoost" DROP CONSTRAINT "TimerSpecialBoost_pkey";
ALTER TABLE "TimerSpecialBoost" ADD CONSTRAINT "TimerSpecialBoost_pkey" PRIMARY KEY ("guildId", "discordUserId", "setId", "key");

ALTER TABLE "TimerUserSettings" ADD COLUMN "guaranteedSpecialId" TEXT;
ALTER TABLE "TimerUserSettings" ADD COLUMN "losingStreak" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "TimerSettings" ADD COLUMN "secondLoveRoleId" TEXT;
