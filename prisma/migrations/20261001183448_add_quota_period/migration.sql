-- CreateEnum
CREATE TYPE "QuotaPeriod" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- AlterTable
ALTER TABLE "TrackedCircle" ADD COLUMN     "quotaPeriod" "QuotaPeriod" NOT NULL DEFAULT 'MONTH';
