import { randomUUID } from 'crypto';
import { EmbedBuilder } from 'discord.js';
import { COLORS } from './embeds';

/**
 * Turns thrown errors into something a human can act on.
 *
 * Before this module every failure surfaced in Discord as the single string
 * "Something went wrong running that command.", which hid the actual cause.
 * The real failure behind that message was Prisma P2021 (the `Club` table did
 * not exist, because migrations were never applied on deploy). A generic
 * message cost real debugging time, so failures are now classified: known
 * causes get a specific, actionable message, and anything unrecognised gets a
 * short incident ID that is also written to the logs for correlation.
 */

/** A classified failure, ready to be shown to a user and written to the log. */
export interface ClassifiedError {
    /** Short embed title, e.g. 'Database Not Migrated'. */
    title: string;
    /** User-facing explanation. Safe to show in Discord; never contains secrets. */
    message: string;
    /**
     * True when the operator (not the person who ran the command) has to fix
     * this. Used to add a "tell an admin" hint to the reply.
     */
    operatorActionRequired: boolean;
    /** Correlation ID, present only for unclassified errors. */
    incidentId?: string;
}

/**
 * Prisma error codes worth explaining individually.
 * Reference: https://www.prisma.io/docs/orm/reference/error-reference
 */
const PRISMA_MESSAGES: Record<string, Omit<ClassifiedError, 'incidentId'>> = {
    P1000: {
        title: 'Database Authentication Failed',
        message: 'The bot could not sign in to the database. The credentials in `DATABASE_URL` are wrong.',
        operatorActionRequired: true,
    },
    P1001: {
        title: 'Database Unreachable',
        message:
            'The bot cannot reach the database server. It may be down, or `DATABASE_URL` may point at the wrong host. ' +
            'Inside Docker the host is the compose service name (`postgres`), not `localhost`.',
        operatorActionRequired: true,
    },
    P1002: {
        title: 'Database Timed Out',
        message: 'The database accepted the connection but timed out before responding. It may be overloaded.',
        operatorActionRequired: true,
    },
    P1003: {
        title: 'Database Does Not Exist',
        message: 'The database named in `DATABASE_URL` does not exist on that server.',
        operatorActionRequired: true,
    },
    P1017: {
        title: 'Database Connection Closed',
        message: 'The database closed the connection mid-query. Retry in a moment; if it persists the server is unstable.',
        operatorActionRequired: true,
    },
    P2021: {
        title: 'Database Not Migrated',
        message:
            'The database is reachable but the tables have not been created. ' +
            'Run `npx prisma migrate deploy` against it, then restart the bot.',
        operatorActionRequired: true,
    },
    P2022: {
        title: 'Database Schema Out Of Date',
        message:
            'The database is missing a column the bot expects, so it is running an older schema than this build. ' +
            'Run `npx prisma migrate deploy`, then restart the bot.',
        operatorActionRequired: true,
    },
    P2002: {
        title: 'Already Exists',
        message: 'A record with that unique value already exists.',
        operatorActionRequired: false,
    },
    P2003: {
        title: 'Related Record Missing',
        message: 'That action references a record that no longer exists. It was probably deleted; try again.',
        operatorActionRequired: false,
    },
    P2025: {
        title: 'Record Not Found',
        message: 'The record this command targets no longer exists. It was probably deleted; try again.',
        operatorActionRequired: false,
    },
};

/**
 * Discord REST error codes worth explaining individually.
 * Reference: https://discord.com/developers/docs/topics/opcodes-and-status-codes
 */
const DISCORD_MESSAGES: Record<number, Omit<ClassifiedError, 'incidentId'>> = {
    10062: {
        title: 'Command Timed Out',
        message:
            'Discord closed this command before the bot answered. The bot took longer than 3 seconds to respond. Try again.',
        operatorActionRequired: false,
    },
    50001: {
        title: 'Missing Access',
        message: 'The bot cannot see that channel or resource. Check its channel permissions.',
        operatorActionRequired: true,
    },
    50013: {
        title: 'Missing Permissions',
        message:
            'The bot lacks a permission this command needs. For role changes its highest role must sit above the role it edits.',
        operatorActionRequired: true,
    },
    50035: {
        title: 'Invalid Request',
        message: 'Discord rejected the data the bot sent. This is a bug in the bot, not something you did wrong.',
        operatorActionRequired: true,
    },
};

/** Reads a `code` property off an unknown thrown value without assuming its type. */
function readErrorCode(error: unknown): string | number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}

/**
 * Maps a thrown value to a user-facing explanation.
 *
 * Unrecognised errors get a generated incident ID. Callers must log that ID
 * alongside the original error so a report from Discord can be traced to a
 * stack trace in the logs.
 */
export function classifyError(error: unknown): ClassifiedError {
    const code = readErrorCode(error);

    if (typeof code === 'string' && PRISMA_MESSAGES[code]) {
        return { ...PRISMA_MESSAGES[code]! };
    }

    if (typeof code === 'number' && DISCORD_MESSAGES[code]) {
        return { ...DISCORD_MESSAGES[code]! };
    }

    // Thrown before any database call when DATABASE_URL is absent entirely.
    if (error instanceof Error && error.message.includes('DATABASE_URL')) {
        return {
            title: 'Database Not Configured',
            message: '`DATABASE_URL` is not set. The bot cannot start without it.',
            operatorActionRequired: true,
        };
    }

    return {
        title: 'Unexpected Error',
        message: 'Something went wrong running that command.',
        operatorActionRequired: true,
        incidentId: randomUUID().slice(0, 8),
    };
}

/** Builds the embed shown in Discord when a command fails. */
export function buildErrorEmbed(classified: ClassifiedError): EmbedBuilder {
    const lines = [classified.message];

    if (classified.incidentId) {
        lines.push(`\nIncident \`${classified.incidentId}\` — search the bot logs for this ID.`);
    }
    if (classified.operatorActionRequired) {
        lines.push('\nThis needs a bot admin to fix. Nothing you did caused it.');
    }

    return new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle(classified.title)
        .setDescription(lines.join('\n'))
        .setTimestamp();
}
