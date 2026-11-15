-- The last scheduled notice set under a panel, so each is set once.
ALTER TABLE "TimerPanel" ADD COLUMN "noticeKey" TEXT;
