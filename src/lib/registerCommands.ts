import { REST, Routes, type Client } from 'discord.js';
import { commands } from '../commands';

/**
 * Registers the slash commands with Discord.
 *
 * Runs automatically on startup so a deploy never depends on someone
 * remembering to run a script from their own machine. The registration is a
 * bulk overwrite (`PUT`), so it is idempotent: running it on every boot simply
 * re-asserts the current command set, and a command removed from the code
 * disappears from Discord on the next restart rather than lingering.
 *
 * The application ID comes from the logged-in client, so `DISCORD_CLIENT_ID`
 * is not needed for this path — one less variable to get wrong.
 */

/** Outcome, for the startup log. */
export interface RegistrationResult {
    count: number;
    /** Guild ID when registered to one guild, null when registered globally. */
    guildId: string | null;
}

/**
 * Registers commands using an already-connected client.
 *
 * With `DEV_GUILD_ID` set, commands are registered to that guild only and
 * appear instantly. Without it they are registered globally, which Discord can
 * take up to an hour to propagate — fine for production, slow for development.
 */
export async function registerCommands(client: Client<true>): Promise<RegistrationResult> {
    const body = [...commands.values()].map((c) => c.data.toJSON());
    const rest = new REST().setToken(client.token);
    const applicationId = client.application.id;
    const guildId = process.env.DEV_GUILD_ID?.trim() || null;

    if (guildId) {
        await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
    } else {
        await rest.put(Routes.applicationCommands(applicationId), { body });
    }

    return { count: body.length, guildId };
}

/**
 * Registers commands from a token alone, for the standalone script.
 *
 * Kept for the case where someone wants to push commands without starting the
 * bot, e.g. to register them to a second development guild.
 */
export async function registerCommandsWithToken(
    token: string,
    applicationId: string,
    guildId: string | null,
): Promise<RegistrationResult> {
    const body = [...commands.values()].map((c) => c.data.toJSON());
    const rest = new REST().setToken(token);

    if (guildId) {
        await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
    } else {
        await rest.put(Routes.applicationCommands(applicationId), { body });
    }

    return { count: body.length, guildId };
}
