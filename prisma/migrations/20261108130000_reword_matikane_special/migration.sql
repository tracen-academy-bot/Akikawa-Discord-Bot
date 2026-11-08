-- The Matikanetannhauser special was reworded. Finds are keyed by the
-- line's text, so move existing finds to the new text; otherwise they would
-- be lost and the owner lock (SPECIAL_LOCKS) would switch back on.
UPDATE "RareOpenerHit"
SET "opener" = $new$Wasshoi~ *trips* Oooooow!... ooh- *tears up, sniffles*, I'm okay, {user}! You're here now! Please come take a look at your trainee!$new$
WHERE "opener" = $old$Wassho~ *trips* Oooooow!...  ooh- My nose? It's fine, {user}! You're here now! Please come take a look at your trainee!$old$;
