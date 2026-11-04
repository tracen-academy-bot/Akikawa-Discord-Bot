-- Whether milestone roles form a ladder (only the highest kept). Additive.
CREATE TABLE "TimerMilestoneSettings" (
    "guildId" TEXT NOT NULL,
    "ladder" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimerMilestoneSettings_pkey" PRIMARY KEY ("guildId")
);
