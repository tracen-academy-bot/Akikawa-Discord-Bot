import { Events, GatewayCloseCodes, type Client } from 'discord.js';

/**
 * Gateway connection outcome detection.
 *
 * `client.login()` resolving does not mean the bot is connected. When Discord
 * refuses the connection for an unrecoverable reason -- a privileged intent
 * that is not enabled, an invalid token -- discord.js marks the shard
 * disconnected, emits `shardDisconnect` with the gateway close code, and
 * returns. It does not throw, and it never emits `ready`. A process waiting
 * for `ready` therefore waits forever, which on a host with a health check
 * becomes a restart loop.
 *
 * This module turns that into an explicit result so startup can react.
 *
 * Correction (2026-10-01): with @discordjs/ws 1.2.x a refused privileged
 * intent can *also* surface as `login()` rejecting with
 * `Error("Used disallowed intents")`. Production hit exactly that after
 * MessageContent was added to the requested intents: startup treated the
 * rejection as fatal, exited, and Railway restart-looped the container.
 * `connect` handles both paths.
 */

export type ConnectOutcome = 'ready' | 'disallowed-intents' | 'fatal';

/** Close codes after which discord.js will not reconnect. */
const FATAL_CLOSE_CODES = new Set<number>([
    GatewayCloseCodes.AuthenticationFailed,
    GatewayCloseCodes.InvalidShard,
    GatewayCloseCodes.ShardingRequired,
    GatewayCloseCodes.InvalidAPIVersion,
    GatewayCloseCodes.InvalidIntents,
]);

/**
 * Resolves once the client is ready, or once the gateway has closed the
 * connection for a reason discord.js will not retry.
 *
 * Must be called before `login()` so no event is missed. Recoverable
 * disconnects (network blips, resumes) are ignored; discord.js handles those
 * itself and `ready` still follows.
 */
export function waitForConnectOutcome(client: Client): Promise<ConnectOutcome> {
    return new Promise((resolve) => {
        const onReady = () => {
            client.off(Events.ShardDisconnect, onDisconnect);
            resolve('ready');
        };
        const onDisconnect = (event: { code: number }) => {
            if (event.code === GatewayCloseCodes.DisallowedIntents) {
                client.off(Events.ClientReady, onReady);
                resolve('disallowed-intents');
            } else if (FATAL_CLOSE_CODES.has(event.code)) {
                client.off(Events.ClientReady, onReady);
                resolve('fatal');
            }
            // Any other code: discord.js reconnects on its own; keep waiting.
        };
        client.once(Events.ClientReady, onReady);
        client.on(Events.ShardDisconnect, onDisconnect);
    });
}

/** True for the error @discordjs/ws raises when a privileged intent is refused. */
export function isDisallowedIntentsError(e: unknown): boolean {
    return e instanceof Error && /disallowed intents/i.test(e.message);
}

/**
 * Logs in and resolves with the connection outcome, whichever way discord.js
 * reports it: the shardDisconnect close code, or `login()` rejecting.
 * A refused privileged intent becomes 'disallowed-intents' either way. Any
 * other login error is rethrown.
 */
export async function connect(client: Client, token: string | undefined): Promise<ConnectOutcome> {
    const outcome = waitForConnectOutcome(client);
    try {
        await client.login(token);
    } catch (e) {
        if (isDisallowedIntentsError(e)) return 'disallowed-intents';
        throw e;
    }
    return outcome;
}
