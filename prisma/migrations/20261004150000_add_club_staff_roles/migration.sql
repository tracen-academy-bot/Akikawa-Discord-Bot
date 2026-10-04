-- Discord roles whose holders count as a club's staff. Additive: existing
-- rows get an empty list, which means "match the club's roles by name".
ALTER TABLE "TrackedCircle" ADD COLUMN "staffRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
