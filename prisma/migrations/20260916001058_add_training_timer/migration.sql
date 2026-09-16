-- CreateTable
CREATE TABLE "TrainingTimer" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "panelMessageId" TEXT,
    "discordUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingTimer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRun" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "deliveryLagS" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimerNotification" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "deleteAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimerNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingTimer_expiresAt_idx" ON "TrainingTimer"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingTimer_guildId_discordUserId_key" ON "TrainingTimer"("guildId", "discordUserId");

-- CreateIndex
CREATE INDEX "TrainingRun_guildId_discordUserId_idx" ON "TrainingRun"("guildId", "discordUserId");

-- CreateIndex
CREATE INDEX "TrainingRun_guildId_completedAt_idx" ON "TrainingRun"("guildId", "completedAt");

-- CreateIndex
CREATE INDEX "TimerNotification_deleteAt_idx" ON "TimerNotification"("deleteAt");
