-- The circle's monthly points on uma.moe at the last sync, beside its rank,
-- for the report's rank band. Additive.
ALTER TABLE "TrackedCircle"
ADD COLUMN "monthlyPoints" BIGINT;
