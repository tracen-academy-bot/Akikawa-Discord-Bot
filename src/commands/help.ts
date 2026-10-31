import {
    ActionRowBuilder,
    ChatInputCommandInteraction,
    ContainerBuilder,
    GuildMember,
    MessageFlags,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextDisplayBuilder,
    ThumbnailBuilder,
} from 'discord.js';
import { commandMention } from '../lib/commandIds';
import { isOfficer } from '../lib/permissions';

/**
 * `/help`: Akikawa's guide to herself, visible only to the person who asked.
 *
 * A laid-out panel (Discord's newer message components), not an embed:
 *
 *   ┌ honey-peach edge ─────────────────────────────── [avatar] ┐
 *   │ ## Akikawa                                                │
 *   │ who she is, in a line · "only you can see this"           │
 *   │ ───────────────────────────────────────────────────────── │
 *   │ the page: "Start here", or one topic's commands, grouped   │
 *   │ by who can use them                                        │
 *   │ ───────────────────────────────────────────────────────── │
 *   │ [ Browse a topic ▾ ]                                       │
 *   └───────────────────────────────────────────────────────────┘
 *
 * "Start here" is the short version: what every trainer uses, and what a
 * club's staff set. The topic menu swaps the page in place. Commands show as
 * mentions, which run when clicked (see `commandIds.ts`).
 *
 * The command lists are built from the registered commands' own names and
 * descriptions, so a new command shows up by itself. Only who may use each
 * one (`AUDIENCE`) and which page it is on (`TOPIC_OF`) are kept here;
 * `scripts/test-commands.ts` fails when a command has neither.
 */

/** Who can use a command. */
export type Audience = 'everyone' | 'staff' | 'managers' | 'moderators';

/** Group headings on a topic page, in order. */
const AUDIENCE_HEADING: Record<Audience, string> = {
    everyone: 'Everyone',
    staff: "A club's Trainers and Assistants, and Club Managers",
    managers: 'Club Managers',
    moderators: 'Moderators',
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

/** The pages, in menu order. */
export type Topic = 'start' | 'fans' | 'clubs' | 'timer' | 'tools';

const TOPICS: Record<Topic, { label: string; blurb: string }> = {
    start: { label: 'Start here', blurb: 'What every trainer uses, and what a club’s staff set.' },
    fans: { label: 'Fans and quota', blurb: 'Daily reports, your own progress, and how clubs compare.' },
    clubs: { label: 'Clubs', blurb: 'Club info, the staff forms, members and the directory.' },
    timer: { label: 'Trainer Timer', blurb: 'Independent Training runs, stats and weekly rewards.' },
    tools: { label: 'Moderation and posting', blurb: 'Club roles, closing threads, and posting as Akikawa.' },
};

/** Which page each top-level command is on. */
export const TOPIC_OF: Record<string, Exclude<Topic, 'start'>> = {
    fans: 'fans',
    'uma-id': 'fans',
    club: 'clubs',
    timer: 'timer',
    role: 'tools',
    settag: 'tools',
    post: 'tools',
    help: 'tools',
};

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
 * A description without the "who can use it" note its group heading already
 * gives, e.g. " Club Managers only." or " (Club Managers)", ending in a full
 * stop.
 */
function plainDescription(text: string): string {
    const plain = text
        .replace(/\s*\((?:its staff or )?Club Managers\)\.?$/, '')
        .replace(/\s*\(its staff; Club Managers also set its tier\)\.?$/, '. Club Managers also set its tier')
        .replace(/\s*\(the club's staff\)\.?$/, '')
        .replace(/\s*Club Managers only\.?$/, '')
        .trim()
        .replace(/\.$/, '');
    return `${plain}.`;
}

/** Akikawa's honey-peach, from the bot's avatar (the `akikawa` palette's frame). */
const ACCENT = 0xf2a87a;
/** The topic menu's custom ID; `index.ts` routes it here. */
export const HELP_SELECT_ID = 'help:topic';

/** True for a component this module owns. */
export function isHelpSelect(customId: string): boolean {
    return customId === HELP_SELECT_ID;
}

/** Who is reading, for the small personal touches. */
export interface Reader {
    /** A Club Manager sees a line saying everything is open to them. */
    manager: boolean;
    /** The bot's avatar for the header; none in tests. */
    avatarUrl?: string | null;
}

/** "Start here": the few commands that matter most, in plain words. */
function startPage(): string[] {
    const line = (name: string, text: string) => `${commandMention(name)}  ${text}`;
    return [
        [
            '### Every trainer',
            line('uma-id', 'Link your uma.moe trainer ID, so the reports know which trainer is you.'),
            line('fans me', "Where you stand against your club's quota. Only you see it."),
            line('timer stats', 'Your Independent Training runs. To log one, press **Start** on the Trainer Timer panel.'),
        ].join('\n'),
        [
            "### Running a club",
            line('club reports', 'When the daily report posts, its theme and layout, and whether it pings staff.'),
            line('club fancount', 'The quota each member is held to.'),
            line('club profile', 'Bio, rules and banner for the club directory.'),
            "-# For a club's Trainers and Assistants, and Club Managers.",
        ].join('\n'),
    ];
}

/** One topic's commands, a block per audience that has any. */
function topicPage(topic: Exclude<Topic, 'start'>, entries: HelpEntry[]): string[] {
    const mine = entries.filter((e) => (TOPIC_OF[e.name.split(' ')[0]!] ?? 'tools') === topic);
    const blocks: string[] = [];
    for (const audience of Object.keys(AUDIENCE_HEADING) as Audience[]) {
        const group = mine.filter((e) => (AUDIENCE[e.name] ?? 'everyone') === audience);
        if (group.length === 0) continue;
        const lines = group.map((e) => {
            const perm = audience === 'moderators' ? MODERATOR_PERMISSION[e.name.split(' ')[0]!] : undefined;
            return `${commandMention(e.name)}  ${plainDescription(e.description)}${perm ? ` *Needs ${perm}.*` : ''}`;
        });
        blocks.push([`**${AUDIENCE_HEADING[audience]}**`, ...lines].join('\n'));
    }
    if (topic === 'timer') {
        blocks.push(
            [
                '**The panel’s buttons**',
                '**Start** begins a run, or restarts yours. **Stop** cancels it, and a cancelled run does not count.',
                "**My Stats** shows your runs, **Leaderboard** this week's board. Both only to you.",
            ].join('\n'),
        );
    }
    if (topic === 'fans') blocks.push("-# Each club's report posts by itself every day at the club's report time; these are for checking in between.");
    return blocks;
}

/**
 * The whole panel for a page. Built from the commands passed in, so tests
 * can run it without a client.
 */
export function buildHelp(commands: CommandJson[], topic: Topic, reader: Reader): ContainerBuilder {
    const entries = helpEntries(commands);
    const head =
        topic === 'start'
            ? [
                  '## Akikawa',
                  "Tracen's club clerk. I keep every club's fans against its quota, post the daily reports, and time your Independent Training.",
                  '-# Pick a topic below for every command. Click one to use it.',
              ].join('\n')
            : [`## ${TOPICS[topic].label}`, TOPICS[topic].blurb, '-# Click a command to use it.'].join('\n');

    const container = new ContainerBuilder().setAccentColor(ACCENT);
    if (reader.avatarUrl) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(head))
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(reader.avatarUrl).setDescription('Akikawa')),
        );
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(head));
    }
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));

    const blocks = topic === 'start' ? startPage() : topicPage(topic, entries);
    blocks.forEach((block, i) => {
        if (i > 0) container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
    });
    if (reader.manager) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# You are a Club Manager, so every command here is open to you.'));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large));
    container.addActionRowComponents(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(HELP_SELECT_ID)
                .setPlaceholder('Browse a topic')
                .addOptions(
                    (Object.keys(TOPICS) as Topic[]).map((t) => ({
                        label: TOPICS[t].label,
                        description: TOPICS[t].blurb.slice(0, 100),
                        value: t,
                        default: t === topic,
                    })),
                ),
        ),
    );
    return container;
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

/** The reader behind an interaction. */
function readerOf(interaction: ChatInputCommandInteraction | StringSelectMenuInteraction): Reader {
    const member = interaction.member;
    return {
        manager: member instanceof GuildMember ? isOfficer(member) : false,
        avatarUrl: interaction.client?.user?.displayAvatarURL({ size: 128 }) ?? null,
    };
}

export const data = new SlashCommandBuilder().setName('help').setDescription('A guide to everything Akikawa can do, and who can use what.');

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({
        components: [buildHelp(commandSource(), 'start', readerOf(interaction))],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
}

/** The topic menu: swaps the page in place. */
export async function handleHelpSelect(interaction: StringSelectMenuInteraction) {
    const picked = interaction.values[0] as Topic | undefined;
    const topic: Topic = picked && picked in TOPICS ? picked : 'start';
    await interaction.update({ components: [buildHelp(commandSource(), topic, readerOf(interaction))] });
}
