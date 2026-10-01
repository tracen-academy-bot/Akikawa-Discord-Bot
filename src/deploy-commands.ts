import 'dotenv/config';
import { registerCommandsWithToken } from './lib/registerCommands';

/**
 * Standalone command registration.
 *
 * Not required for a normal deploy: the bot registers its own commands on
 * startup (see `src/lib/registerCommands.ts`). This script exists for pushing
 * the command set without starting the bot, such as to an extra guild.
 */
(async () => {
    const token = process.env.DISCORD_TOKEN;
    const applicationId = process.env.DISCORD_CLIENT_ID;

    if (!token || !applicationId) {
        console.error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required.');
        process.exit(1);
    }

    try {
        const result = await registerCommandsWithToken(token, applicationId, process.env.DEV_GUILD_ID?.trim() || null);
        console.log(
            result.guildId
                ? `Registered ${result.count} commands to guild ${result.guildId}.`
                : `Registered ${result.count} global commands. Propagation can take up to an hour.`,
        );
    } catch (e) {
        console.error('Failed to register commands:', e);
        process.exit(1);
    }
})();
