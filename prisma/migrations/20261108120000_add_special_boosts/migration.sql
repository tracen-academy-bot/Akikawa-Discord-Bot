-- Special sets: boosts and the Early Riser boost.
ALTER TABLE "TrainingTimer" ADD COLUMN "earlyStart" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TimerUserSettings" ADD COLUMN "boosts" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "TimerSpecialBoost" (
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "runsLeft" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimerSpecialBoost_pkey" PRIMARY KEY ("guildId","discordUserId","setId")
);
