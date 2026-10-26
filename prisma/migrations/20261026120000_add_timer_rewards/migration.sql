-- Timer rewards: a weekly top-runner role, milestone roles, and the award
-- history used to take the weekly role back. Additive.
CREATE TABLE "TimerSettings" (
    "guildId" TEXT NOT NULL,
    "topRoleId" TEXT,
    "announceChannelId" TEXT,
    "lastAwardedWeek" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TimerSettings_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "TimerMilestoneRole" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "runs" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "TimerMilestoneRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TimerMilestoneRole_guildId_runs_key" ON "TimerMilestoneRole"("guildId", "runs");

CREATE TABLE "TimerWeeklyAward" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "place" INTEGER NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "runs" INTEGER NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimerWeeklyAward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TimerWeeklyAward_guildId_week_place_key" ON "TimerWeeklyAward"("guildId", "week", "place");
CREATE INDEX "TimerWeeklyAward_guildId_week_idx" ON "TimerWeeklyAward"("guildId", "week");
