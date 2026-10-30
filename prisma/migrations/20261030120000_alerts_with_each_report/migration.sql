-- The behind-quota alert now goes with every report or not at all (a tick
-- in /club reports). Clubs on the old every-3-days or weekly cadence move
-- to every report. Data only; no schema change.
UPDATE "TrackedCircle" SET "alertFrequency" = 'DAILY' WHERE "alertFrequency" IN ('EVERY_3_DAYS', 'WEEKLY');
