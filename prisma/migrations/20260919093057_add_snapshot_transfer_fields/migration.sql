-- AlterTable
ALTER TABLE "FanSnapshot" ADD COLUMN     "nextMonthStart" BIGINT,
ADD COLUMN     "previousCircleId" BIGINT,
ADD COLUMN     "previousCircleName" TEXT;
