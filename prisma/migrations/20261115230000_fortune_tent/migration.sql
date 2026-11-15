-- Fuku-chan's Fortune Tent: the unlock and the introduction owed, per trainer.
ALTER TABLE "TimerUserSettings" ADD COLUMN "tentUnlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TimerUserSettings" ADD COLUMN "tentIntroOwed" BOOLEAN NOT NULL DEFAULT false;

-- One omikuji per trainer per day.
CREATE TABLE "TimerFortuneDraw" (
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "drawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimerFortuneDraw_pkey" PRIMARY KEY ("guildId","discordUserId","day")
);

CREATE INDEX "TimerFortuneDraw_guildId_discordUserId_drawnAt_idx" ON "TimerFortuneDraw"("guildId", "discordUserId", "drawnAt");
