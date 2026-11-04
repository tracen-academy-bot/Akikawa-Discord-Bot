-- The live recruitment board message, one per guild. Additive.
CREATE TABLE "RecruitmentBoard" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentBoard_pkey" PRIMARY KEY ("guildId")
);
