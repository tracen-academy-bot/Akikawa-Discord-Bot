-- Welcome options: the "Say hi!" button and boost thank-yous. Additive.
ALTER TABLE "WelcomeSettings" ADD COLUMN "wave" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WelcomeSettings" ADD COLUMN "boosts" BOOLEAN NOT NULL DEFAULT true;
