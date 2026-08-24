import { REST, Routes } from 'discord.js';
import 'dotenv/config';
import { commands } from './commands';

const commandData = [...commands.values()].map((c) => c.data.toJSON());
const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

(async () => {
    try {
        const clientId = process.env.DISCORD_CLIENT_ID!;
        const guildId = process.env.DEV_GUILD_ID;

        if (guildId) {
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
            console.log(`Registered ${commandData.length} commands to guild ${guildId}`);
        } else {
            await rest.put(Routes.applicationCommands(clientId), { body: commandData });
            console.log(`Registered ${commandData.length} global commands`)
        }
    } catch (e) {
        console.error('Failed to register: ', e);
    }
})();