-- Rare timer-ping openers that came up, for /timer rares. Additive.
CREATE TABLE "RareOpenerHit" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "opener" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RareOpenerHit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RareOpenerHit_guildId_idx" ON "RareOpenerHit"("guildId");
