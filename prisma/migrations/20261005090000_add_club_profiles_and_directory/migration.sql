-- Club profiles (tier, bio, rules, banner) and the club directory. Additive:
-- existing clubs get no tier, bio, rules or banner, and stay out of the
-- directory until a Club Manager gives them a tier.

CREATE TYPE "ClubTier" AS ENUM ('G1', 'G2', 'G3', 'DEBUT');

ALTER TABLE "TrackedCircle"
ADD COLUMN "tier" "ClubTier",
ADD COLUMN "bio" TEXT,
ADD COLUMN "rules" TEXT;

CREATE TABLE "ClubBanner" (
    "clubId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubBanner_pkey" PRIMARY KEY ("clubId")
);

CREATE TABLE "ClubDirectory" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "layout" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "messageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubDirectory_pkey" PRIMARY KEY ("guildId")
);

ALTER TABLE "ClubBanner" ADD CONSTRAINT "ClubBanner_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "TrackedCircle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
