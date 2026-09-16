import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Create a .env file (see .env.example) before starting the bot.');
}

export const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

/**
 * Verifies at boot that the database is reachable AND migrated.
 *
 * Without this check a missing schema stays invisible until someone runs a
 * command, and then shows up in Discord as a generic failure. That is exactly
 * how the `/club list` and `/club create` outage presented: the container
 * started cleanly, logged in to Discord, and only failed once a command
 * touched a table that had never been created. Failing loudly at startup
 * makes the same fault obvious in the first lines of the container log.
 *
 * @throws If the database is unreachable or migrations have not been applied.
 */
export async function assertDatabaseReady(): Promise<void> {
    // Confirms connectivity and credentials. Fails with P1001 / P1000 if not.
    await prisma.$queryRaw`SELECT 1`;

    // Confirms migrations ran. `to_regclass` returns NULL for a missing table
    // instead of raising, so a missing schema is reported as our own clear
    // error rather than a raw Prisma P2021 at some later, unrelated moment.
    const rows = await prisma.$queryRaw<{ table: string | null }[]>`
        SELECT to_regclass('public."Club"')::text AS table
    `;

    if (rows[0]?.table == null) {
        throw new Error(
            'Database is reachable but not migrated: the "Club" table does not exist. ' +
                'Run `npx prisma migrate deploy` against DATABASE_URL, then restart the bot.',
        );
    }
}
