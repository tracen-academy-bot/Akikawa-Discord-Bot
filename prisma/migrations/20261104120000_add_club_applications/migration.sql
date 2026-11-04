-- Club applications: one row per post in the application forum, with the
-- decision and the applicant's pace. Additive.
CREATE TYPE "ApplicationStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'JOINED', 'WITHDRAWN');

CREATE TABLE "ClubApplication" (
    "threadId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "viewerId" BIGINT,
    "trainerName" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ApplicationStatus" NOT NULL DEFAULT 'OPEN',
    "clubId" TEXT,
    "clubName" TEXT,
    "note" TEXT,
    "pace30" BIGINT,
    "pace3m" BIGINT,
    "pace6m" BIGINT,
    "recruitmentChannelId" TEXT,
    "recruitmentMessageId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubApplication_pkey" PRIMARY KEY ("threadId")
);

CREATE INDEX "ClubApplication_guildId_status_idx" ON "ClubApplication"("guildId", "status");
