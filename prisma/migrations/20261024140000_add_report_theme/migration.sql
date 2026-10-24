-- The palette a club's fan report is drawn in (an id from PALETTES in
-- src/lib/image/theme.ts). Null means the default. Additive.
ALTER TABLE "TrackedCircle"
ADD COLUMN "reportTheme" TEXT;
