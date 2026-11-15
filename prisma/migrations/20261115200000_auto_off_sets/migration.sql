-- Sets whose completion was handled for a trainer (auto-off of finished sets).
ALTER TABLE "TimerUserSettings" ADD COLUMN "autoOffSets" TEXT[] DEFAULT ARRAY[]::TEXT[];
