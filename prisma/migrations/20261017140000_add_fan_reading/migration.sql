-- Each sync's lifetime fan totals, kept for two days, so a report can show
-- fans earned in the 24 hours before it. Additive.
CREATE TABLE "FanReading" (
    "id" TEXT NOT NULL,
    "trackedCircleId" TEXT NOT NULL,
    "viewerId" BIGINT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "total" BIGINT NOT NULL,

    CONSTRAINT "FanReading_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FanReading_trackedCircleId_takenAt_idx" ON "FanReading"("trackedCircleId", "takenAt");

ALTER TABLE "FanReading" ADD CONSTRAINT "FanReading_trackedCircleId_fkey" FOREIGN KEY ("trackedCircleId") REFERENCES "TrackedCircle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
