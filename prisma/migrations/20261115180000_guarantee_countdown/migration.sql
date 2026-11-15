-- Runs until a trainer's guaranteed special comes up (a scheduled Remedial Rehearsal).
ALTER TABLE "TimerUserSettings" ADD COLUMN "guaranteedInRuns" INTEGER;
