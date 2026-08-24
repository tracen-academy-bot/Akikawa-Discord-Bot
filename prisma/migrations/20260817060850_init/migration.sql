-- CreateEnum
CREATE TYPE "ClubRank" AS ENUM ('B', 'B_PLUS', 'A', 'A_PLUS', 'S', 'S_PLUS');

-- CreateEnum
CREATE TYPE "ClubMemberRole" AS ENUM ('TRAINER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "FanCountPeriod" AS ENUM ('DAY', 'WEEK', 'BIWEEKLY', 'MONTH');

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" "ClubRank" NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 0,
    "fanCountAmount" DOUBLE PRECISION,
    "fanCountPeriod" "FanCountPeriod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubMember" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "role" "ClubMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Club_name_key" ON "Club"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ClubMember_clubId_discordUserId_key" ON "ClubMember"("clubId", "discordUserId");

-- AddForeignKey
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
