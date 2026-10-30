import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLORS } from '../lib/embeds';

/**
 * `/help`: every command Akikawa has, grouped by who can use it, visible only
 * to the person who asked.
 *
 * The list is built from the registered commands themselves (their names and
 * descriptions), so a new command or subcommand shows up without editing
 * this file. Only who may use each one is kept here, in `AUDIENCE`, because
 * that lives in each handler's permission checks rather than in the command
 * data. `scripts/test-commands.ts` fails when a command has no entry, so the
 * help cannot quietly fall behind.
 */

/** Who can use a command, in the order the help lists them. */
export type Audience = 'everyone' | 'staff' | 'managers' | 'moderators';

/** Section headings, in order. */
const SECTIONS: Record<Audience, string> = {
    everyone: 'Everyone',
    staff: "A club's staff (its Trainers and Assistants) and Club Managers",
    managers: 'Club Managers',
    moderators: 'Moderators (needs the Discord permission named)',
};

/**
 * Who can use each command, by its full name ("club view", "fans circle add").
 * Mirrors the handlers' checks: `isOfficer` is Club Managers,
 * `canManageClubStats` and `isClubStaff` are a club's staff. `/role` and
 * `/settag` are hidden by Discord from members without the permission.
 */
export const AUDIENCE: Record<string, Audience> = {
    help: 'everyone',
    'uma-id': 'everyone',
    'club view': 'everyone',
    'club list': 'everyone',
    'club links': 'everyone',
    'fans report': 'everyone',
    'fans me': 'everyone',
    'fans trainer': 'everyone',
    'fans benchmark': 'everyone',
    'fans circle list': 'everyone',
    'timer stats': 'everyone',
    'timer leaderboard': 'everyone',

    'club profile': 'staff',
    'club fancount': 'staff',
    'club reports': 'staff',
    'fans club': 'staff',

    'club create': 'managers',
    'club admin': 'managers',
    'club delete': 'managers',
    'club directory': 'managers',
    'club member add': 'managers',
    'club member edit': 'managers',
    'club member remove': 'managers',
    'club member list': 'managers',
    'fans all': 'managers',
    'fans circle add': 'managers',
    'fans circle remove': 'managers',
    'fans circle config': 'managers',
    'fans circle search': 'managers',
    'fans circle debug': 'managers',
    'fans circle sync': 'managers',
    'timer panel': 'managers',
    'timer rewards': 'managers',
    'timer publish': 'managers',
    'timer milestone add': 'managers',
    'timer milestone remove': 'managers',
    post: 'managers',

    'role add': 'moderators',
    'role remove': 'moderators',
    settag: 'moderators',
};

/** The Discord permission each moderator command needs, by top-level name. */
const MODERATOR_PERMISSION: Record<string, string> = { role: 'Manage Roles', settag: 'Manage Threads' };

/** A command as Discord stores it: the fields the help reads. */
export interface CommandJson {
    name: string;
    description: string;
    type?: number;
    options?: CommandJson[];
}

/** Option types for a subcommand and a subcommand group. */
const SUBCOMMAND = 1;
const GROUP = 2;

/** One runnable command: its full name and what it does. */
export interface HelpEntry {
    name: string;
    description: string;
}

/**
 * Every runnable command: a top-level command with no subcommands, or each
 * subcommand, including those inside a group ("club member add").
 */
export function helpEntries(commands: CommandJson[]): HelpEntry[] {
    const out: HelpEntry[] = [];
    for (const command of commands) {
        const subs = (command.options ?? []).filter((o) => o.type === SUBCOMMAND || o.type === GROUP);
        if (subs.length === 0) {
            out.push({ name: command.name, description: command.description });
            continue;
        }
        for (const sub of subs) {
            if (sub.type === SUBCOMMAND) out.push({ name: `${command.name} ${sub.name}`, description: sub.description });
            else for (const inner of sub.options ?? []) out.push({ name: `${command.name} ${sub.name} ${inner.name}`, description: inner.description });
        }
    }
    return out;
}

/**
 * A description without the "who can use it" note the section heading
 * already gives, e.g. " Club Managers only." or " (Club Managers)".
 */
function plainDescription(text: string): string {
    return text
        .replace(/\s*\((?:its staff or )?Club Managers\)\.?$/, '.')
        .replace(/\s*\(its staff; Club Managers also set its tier\)\.?$/, '. Club Managers also set its tier.')
        .replace(/\s*\(the club's staff\)\.?$/, '.')
        .replace(/\s*Club Managers only\.?$/, '')
        .replace(/\.\.$/, '.')
        .trim();
}

/** Discord's limit on one embed field's text. */
const FIELD_LIMIT = 1024;

/**
 * The help: one embed, a field per audience and top-level command (so no
 * field passes Discord's 1024 characters), then the Trainer Timer panel's
 * buttons. Commands with no `AUDIENCE` entry are listed under Everyone,
 * though the test makes sure there are none.
 */
export function buildHelp(commands: CommandJson[]): EmbedBuilder {
    const entries = helpEntries(commands);
    const embed = new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('Akikawa: everything I can do')
        .setDescription(
            'Type `/` and a command name to use one. Grouped by who can use it; each group is open to everything above it too ' +
                '(Club Managers can do what staff can). Only you can see this.',
        );
    for (const audience of Object.keys(SECTIONS) as Audience[]) {
        const mine = entries.filter((e) => (AUDIENCE[e.name] ?? 'everyone') === audience);
        const families = [...new Set(mine.map((e) => e.name.split(' ')[0]!))];
        for (const family of families) {
            const lines = mine
                .filter((e) => e.name.split(' ')[0] === family)
                .map((e) => {
                    const perm = audience === 'moderators' && MODERATOR_PERMISSION[family] ? ` *(${MODERATOR_PERMISSION[family]})*` : '';
                    return `\`/${e.name}\` ${plainDescription(e.description)}${perm}`;
                });
            let value = lines.join('\n');
            if (value.length > FIELD_LIMIT) value = `${value.slice(0, FIELD_LIMIT - 1)}…`;
            embed.addFields({ name: `${SECTIONS[audience]} · /${family}`, value });
        }
    }
    embed.addFields({
        name: 'Trainer Timer panel (buttons)',
        value:
            '**Start** begins an Independent Training run, or restarts yours. **Stop** cancels it; a cancelled run does not count. ' +
            "**My Stats** shows your runs and **Leaderboard** this week's board, both only to you.",
    });
    return embed;
}

/**
 * Where `/help` reads the commands from. Set by `index.ts` once every command
 * is registered; this module cannot import that list, which imports it.
 */
let commandSource: () => CommandJson[] = () => [];

/** Hands `/help` the registered commands. */
export function setHelpSource(source: () => CommandJson[]): void {
    commandSource = source;
}

export const data = new SlashCommandBuilder().setName('help').setDescription('List everything Akikawa can do, and who can use what.');

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ embeds: [buildHelp(commandSource())], flags: MessageFlags.Ephemeral });
}
