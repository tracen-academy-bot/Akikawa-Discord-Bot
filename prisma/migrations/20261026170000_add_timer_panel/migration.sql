-- Where each channel's timer panel and live leaderboard are, so they can be
-- reposted together at the bottom of the channel. Additive.
CREATE TABLE "TimerPanel" (
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "panelMessageId" TEXT NOT NULL,
    "boardMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimerPanel_pkey" PRIMARY KEY ("channelId")
);

CREATE INDEX "TimerPanel_guildId_idx" ON "TimerPanel"("guildId");
