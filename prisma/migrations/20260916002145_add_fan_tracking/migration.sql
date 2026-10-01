-- CreateTable
CREATE TABLE "TrackedCircle" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "circleId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "clubId" TEXT,
    "monthlyQuota" BIGINT NOT NULL DEFAULT 0,
    "reportChannelId" TEXT,
    "alertChannelId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedCircle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerLink" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "viewerId" BIGINT NOT NULL,
    "trainerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FanSnapshot" (
    "id" TEXT NOT NULL,
    "trackedCircleId" TEXT NOT NULL,
    "viewerId" BIGINT NOT NULL,
    "trainerName" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "cumulativeFans" BIGINT NOT NULL,
    "shameScore" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FanSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkSnapshot" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "tier" INTEGER NOT NULL,
    "entryValue" BIGINT NOT NULL,
    "avgValue" BIGINT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackedCircle_active_idx" ON "TrackedCircle"("active");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedCircle_guildId_circleId_key" ON "TrackedCircle"("guildId", "circleId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerLink_guildId_discordUserId_key" ON "TrainerLink"("guildId", "discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerLink_guildId_viewerId_key" ON "TrainerLink"("guildId", "viewerId");

-- CreateIndex
CREATE INDEX "FanSnapshot_trackedCircleId_year_month_idx" ON "FanSnapshot"("trackedCircleId", "year", "month");

-- CreateIndex
CREATE INDEX "FanSnapshot_viewerId_idx" ON "FanSnapshot"("viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "FanSnapshot_trackedCircleId_viewerId_year_month_day_key" ON "FanSnapshot"("trackedCircleId", "viewerId", "year", "month", "day");

-- CreateIndex
CREATE INDEX "BenchmarkSnapshot_year_month_idx" ON "BenchmarkSnapshot"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkSnapshot_year_month_day_tier_key" ON "BenchmarkSnapshot"("year", "month", "day", "tier");

-- AddForeignKey
ALTER TABLE "TrackedCircle" ADD CONSTRAINT "TrackedCircle_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FanSnapshot" ADD CONSTRAINT "FanSnapshot_trackedCircleId_fkey" FOREIGN KEY ("trackedCircleId") REFERENCES "TrackedCircle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
