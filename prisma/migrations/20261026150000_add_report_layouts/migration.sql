-- The layouts a club's fan report posts in ("tall" and/or "wide"), one image
-- each. Existing clubs keep the tall report they had. Additive.
ALTER TABLE "TrackedCircle"
ADD COLUMN "reportLayouts" TEXT[] DEFAULT ARRAY['tall']::TEXT[];
