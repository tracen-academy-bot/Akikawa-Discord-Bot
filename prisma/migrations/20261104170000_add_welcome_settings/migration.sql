-- The welcome message for new members, one row per guild. Additive.
CREATE TABLE "WelcomeSettings" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "message" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WelcomeSettings_pkey" PRIMARY KEY ("guildId")
);
