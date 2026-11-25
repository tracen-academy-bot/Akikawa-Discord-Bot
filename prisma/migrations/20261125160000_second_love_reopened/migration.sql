-- Owner, 2026-11-25: 916564075301978112, the first Ramonu's Second Love, is
-- disqualified (an in-game cheater). Their First Victor record goes, so the
-- race is open again: Ramonu's +2% (`SeasonalBuff.endsOnSecondLove`) is back
-- until the next first win, and that win sets the win notice again. Their
-- role and their own `secondLove` flag are not touched here.
DELETE FROM "TimerSecondLove" WHERE "firstUserId" = '916564075301978112';
