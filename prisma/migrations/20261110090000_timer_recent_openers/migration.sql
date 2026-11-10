-- A trainer's latest reminder lines, so the same one is not repeated back to back.
ALTER TABLE "TimerUserSettings" ADD COLUMN "recentOpeners" TEXT[] DEFAULT ARRAY[]::TEXT[];
