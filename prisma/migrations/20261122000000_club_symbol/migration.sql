-- The symbol either side of a club's name in its directory post. Null shows a star.
ALTER TABLE "TrackedCircle" ADD COLUMN "symbol" TEXT;

-- From the server's old hand-made directory: First used a white heart.
-- Spica used a star, which is already what null shows.
UPDATE "TrackedCircle" SET "symbol" = '🤍' WHERE "name" = 'First';
