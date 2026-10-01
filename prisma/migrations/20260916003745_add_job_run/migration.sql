-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);
