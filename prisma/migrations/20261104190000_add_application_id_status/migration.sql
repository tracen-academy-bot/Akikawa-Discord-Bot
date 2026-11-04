-- Whether an application's trainer ID lookup is waiting on uma.moe or found
-- no trainer. Additive.
ALTER TABLE "ClubApplication" ADD COLUMN "idStatus" TEXT;
ALTER TABLE "ClubApplication" ADD COLUMN "idStatusSince" TIMESTAMP(3);
