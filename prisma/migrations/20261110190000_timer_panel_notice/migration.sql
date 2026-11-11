-- The sticky announcement under the timer panel (`/timer notice`) and its message.
ALTER TABLE "TimerPanel" ADD COLUMN "notice" TEXT;
ALTER TABLE "TimerPanel" ADD COLUMN "noticeMessageId" TEXT;
