import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Runs database migrations from inside the bot process.
 *
 * Migrations used to run in the container entrypoint, before Node started.
 * That meant nothing listened on the port while they ran or retried, and when
 * they failed the only evidence was in the host's deploy log. During one
 * incident the bot sat in a 502/timeout loop for half an hour with the cause
 * invisible from outside.
 *
 * Now the HTTP server binds first and this runs after, so `/healthz` can
 * report exactly what the migration step is doing, including the Prisma
 * error code and message when it fails. Failure keeps retrying with backoff
 * rather than exiting: a live process that says why it is stuck is worth more
 * than a restart loop.
 */

export type MigrationState = 'pending' | 'running' | 'applied' | 'failed';

export interface MigrationStatus {
    state: MigrationState;
    attempts: number;
    /** Prisma error code parsed from output, e.g. "P3009", when available. */
    errorCode: string | null;
    /** Last lines of output from the failing attempt. */
    error: string | null;
    appliedAt: string | null;
}

/** Live status, read by the health endpoint. Mutated in place by runMigrations. */
export const migrationStatus: MigrationStatus = {
    state: 'pending',
    attempts: 0,
    errorCode: null,
    error: null,
    appliedAt: null,
};

/** Upper bound on the delay between attempts. */
const MAX_BACKOFF_MS = 60_000;

/** Path to the Prisma CLI installed as a dependency. */
const PRISMA_BIN = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'prisma');

/** Runs `prisma migrate deploy` once, resolving with its exit code and output. */
function deployOnce(): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
        const child = spawn(PRISMA_BIN, ['migrate', 'deploy'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (d: Buffer) => (output += d.toString()));
        child.stderr.on('data', (d: Buffer) => (output += d.toString()));
        child.on('error', (e) => resolve({ code: -1, output: `${output}\n${e.message}` }));
        child.on('close', (code) => resolve({ code: code ?? -1, output }));
    });
}

/** Pulls a Prisma error code such as P3009 out of CLI output. */
function parseErrorCode(output: string): string | null {
    return /\b(P\d{4})\b/.exec(output)?.[1] ?? null;
}

/** Trims CLI output to the informative tail for the health endpoint. */
function summarise(output: string): string {
    const lines = output.split('\n').map((l) => l.trimEnd()).filter(Boolean);
    return lines.slice(-12).join('\n').slice(0, 1500);
}

/**
 * Applies pending migrations, retrying until they succeed.
 *
 * Never rejects and never exits the process. Each failure is recorded on
 * `migrationStatus` so `/healthz` can show it, and the next attempt waits
 * with exponential backoff capped at one minute. Resolves once applied.
 */
export async function runMigrations(): Promise<void> {
    let delay = 2_000;
    for (;;) {
        migrationStatus.state = 'running';
        migrationStatus.attempts += 1;

        const { code, output } = await deployOnce();
        if (code === 0) {
            migrationStatus.state = 'applied';
            migrationStatus.errorCode = null;
            migrationStatus.error = null;
            migrationStatus.appliedAt = new Date().toISOString();
            console.log(`[migrate] Migrations applied (attempt ${migrationStatus.attempts}).`);
            return;
        }

        migrationStatus.state = 'failed';
        migrationStatus.errorCode = parseErrorCode(output);
        migrationStatus.error = summarise(output);
        console.error(
            `[migrate] Attempt ${migrationStatus.attempts} failed${migrationStatus.errorCode ? ` (${migrationStatus.errorCode})` : ''}. ` +
                `Retrying in ${Math.round(delay / 1000)}s. Details are on /healthz.\n${migrationStatus.error}`,
        );

        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(MAX_BACKOFF_MS, delay * 2);
    }
}
