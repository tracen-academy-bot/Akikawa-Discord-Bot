-- Each club can set its daily report time and time zone. Additive: existing
-- clubs keep the default (null, null), which is FAN_SYNC_HOUR_UTC in UTC.
ALTER TABLE "TrackedCircle"
ADD COLUMN "reportMinute" INTEGER,
ADD COLUMN "reportTimeZone" TEXT,
ADD COLUMN "lastReportAt" TIMESTAMP(3);

-- Reports were posted by one daily job until now. Its last run counts as each
-- club's last report, so a deploy later the same day does not post twice.
UPDATE "TrackedCircle"
SET "lastReportAt" = (SELECT "lastRunAt" FROM "JobRun" WHERE "id" = 'daily-fan-sync');
