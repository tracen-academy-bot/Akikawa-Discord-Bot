-- The symbol either side of a club's name in its directory post. Null shows a star.
ALTER TABLE "TrackedCircle" ADD COLUMN "symbol" TEXT;

-- From the server's old hand-made directory (screenshots, 2026-11-22). Spica
-- and Capella used a star, which is what null shows; Tempest was not in it.
UPDATE "TrackedCircle" SET "symbol" = '🤍' WHERE "name" IN ('First', 'Rose');
UPDATE "TrackedCircle" SET "symbol" = '☆' WHERE "name" = 'Cosmos';
UPDATE "TrackedCircle" SET "symbol" = '୨୧' WHERE "name" IN ('Primrose', 'Alkes', 'Canopus', 'Altair', 'Ascella', 'Lily', 'Umbra');
