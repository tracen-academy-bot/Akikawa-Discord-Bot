-- The first trainer on a server to earn Ramonu's Second Love.
CREATE TABLE "TimerSecondLove" (
    "guildId" TEXT NOT NULL,
    "firstUserId" TEXT NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimerSecondLove_pkey" PRIMARY KEY ("guildId")
);
