-- Per-trainer timer settings: DM pings, early riser, special sets turned off. Additive.
CREATE TABLE "TimerUserSettings" (
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "dmPing" BOOLEAN NOT NULL DEFAULT false,
    "earlyRiser" BOOLEAN NOT NULL DEFAULT false,
    "disabledSets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimerUserSettings_pkey" PRIMARY KEY ("guildId","discordUserId")
);
