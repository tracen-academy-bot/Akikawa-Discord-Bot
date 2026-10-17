-- Rules and goals uploaded as a Markdown file in /club profile. Additive.
ALTER TABLE "TrackedCircle"
ADD COLUMN "rulesFile" TEXT,
ADD COLUMN "rulesFileName" TEXT;
