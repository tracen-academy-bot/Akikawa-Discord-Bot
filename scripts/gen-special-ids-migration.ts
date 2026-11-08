/**
 * Prints the SQL that backfills `RareOpenerHit.specialId` from the current
 * special texts. Used once to write
 * `prisma/migrations/20261108140000_special_ids/migration.sql`; kept so the
 * backfill can be checked against `openers.ts`.
 *
 *   npx ts-node --project tsconfig.scripts.json scripts/gen-special-ids-migration.ts
 */
import { RARE_OPENERS } from '../src/lib/timer/openers';

/** A Postgres dollar-quote tag that no special's text contains. */
const TAG = '$' + 't' + '$';

const lines = [
    '-- Finds are keyed by a stable special id from now on, not by the text.',
    '-- Backfill: each existing find gets the id of the special whose current',
    '-- text it matches. A find of a line that no longer exists keeps NULL.',
    'ALTER TABLE "RareOpenerHit" ADD COLUMN "specialId" TEXT;',
    'CREATE INDEX "RareOpenerHit_guildId_specialId_idx" ON "RareOpenerHit"("guildId", "specialId");',
    '',
];
for (const o of RARE_OPENERS) {
    if (o.text.includes(TAG)) throw new Error(`Special ${o.id} contains the quote tag ${TAG}.`);
    lines.push(`UPDATE "RareOpenerHit" SET "specialId" = '${o.id}' WHERE "opener" = ${TAG}${o.text}${TAG};`);
}
process.stdout.write(lines.join('\n') + '\n');
