-- How often a club's staff roles are pinged about members behind quota, and
-- when they last were. Additive; existing clubs default to daily.
CREATE TYPE "AlertFrequency" AS ENUM ('DAILY', 'WEEKLY', 'NONE');

ALTER TABLE "TrackedCircle"
ADD COLUMN "alertFrequency" "AlertFrequency" NOT NULL DEFAULT 'DAILY',
ADD COLUMN "lastAlertAt" TIMESTAMP(3);
