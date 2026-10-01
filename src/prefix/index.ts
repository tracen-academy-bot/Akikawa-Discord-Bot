import { Collection, Message } from 'discord.js';
import { errorEmbed } from '../lib/embeds';
import * as role from './role';

/**
 * Text-prefix commands (e.g. `;role add ...`), for people used to Dyno's old
 * syntax. Slash commands remain the main interface; these are a shortcut.
 *
 * Requires the GuildMessages intent and the privileged MessageContent intent
 * (enable it under Bot -> Privileged Gateway Intents in the developer portal).
 */

export interface PrefixCommand {
    name: string;
    usage: (prefix: string) => string;
    execute: (message: Message<true>, args: string[], prefix: string) => Promise<void>;
}

export const PREFIX = process.env.COMMAND_PREFIX ?? ';';

const prefixCommands = new Collection<string, PrefixCommand>();
prefixCommands.set(role.name, role);

/**
 * Splits on whitespace, but keeps "double quoted" chunks together so member
 * names with spaces can be passed as a single argument.
 */
export function tokenize(input: string): string[] {
    const tokens: string[] = [];
    const re = /"([^"]*)"|(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(input)) !== null) {
        tokens.push(match[1] ?? match[2] ?? '');
    }
    return tokens.filter(Boolean);
}

/** messageCreate handler. Ignores DMs, bots, and messages without the prefix. */
export async function handlePrefixMessage(message: Message): Promise<void> {
    if (message.author.bot || !message.inGuild()) return;
    if (!message.content.startsWith(PREFIX)) return;

    const [commandName, ...args] = tokenize(message.content.slice(PREFIX.length));
    if (!commandName) return;

    const command = prefixCommands.get(commandName.toLowerCase());
    if (!command) return;

    try {
        await command.execute(message, args, PREFIX);
    } catch (e) {
        console.error(`Error running ${PREFIX}${commandName}:`, e);
        await message
            .reply({ embeds: [errorEmbed('Something went wrong running that command.')], allowedMentions: { repliedUser: false } })
            .catch(() => {});
    }
}
