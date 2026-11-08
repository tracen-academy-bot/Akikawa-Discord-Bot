import type { StringSelectMenuInteraction } from 'discord.js';
import { SETTINGS_PREFIX, getUserSettings, runMinutes, settingsView, toggleSetting } from '../lib/timer/userSettings';
import { READ_MENU_ID, SPECIALS_FIRST_PAGE, SPECIALS_PAGE_PREFIX, SPECIALS_SET_PREFIX, lockedSetsFor, mySpecialsView, pageOfSet, rareTally, readSpecial, specialEmbed, specialsView } from '../lib/timer/rares';
import { EARLY_START } from '../lib/timer/openers';
import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    ButtonInteraction,
    MessageFlags,
    AttachmentBuilder,
    ChannelType,
    GuildMember,
} from 'discord.js';
import { isOfficer } from '../lib/permissions';
import { errorEmbed, infoEmbed, successEmbed } from '../lib/embeds';
import { BOOSTS_TOGGLE_ID, boostsView } from '../lib/timer/boosts';
import {
    BUTTON_BOOSTS,
    BUTTON_LEADERBOARD,
    BUTTON_SPECIALS,
    BUTTON_SETTINGS,
    BUTTON_START,
    BUTTON_STATS,
    BUTTON_STOP,
    buildPanel,
    refreshPanel,
} from '../lib/timer/panel';
import {
    TRAINING_MINUTES,
    getDailyRunCounts,
    getHourlyHeatmap,
    getPanelContext,
    getTrainerStats,
    listActiveTimers,
    startTimer,
    stopTimer,
} from '../lib/timer/service';
import {
    AWARD_PLACES,
    placesLabel,
    milestoneLadder,
    syncMilestones,
    getBoard,
    getMilestoneRoles,
    getTimerSettings,
    nextWeekStart,
    roleProblem,
    saveTimerSettings,
    shiftKey,
    weekKey,
    weekLabel,
    type BoardPeriod,
} from '../lib/timer/rewards';
import { displayName, renderBoardFor, renderSpecialsBoardFor, weekResultsPost } from '../lib/timer/boardImage';
import { keepPanelAtBottom, postPanelPair } from '../lib/timer/livePanel';
import { prisma } from '../db/prisma';
import { renderTimerStats } from '../lib/image/renderTimerStats';

/**
 * Independent Training timer commands and panel buttons.
 *
 * The panel is the primary interface; the slash commands exist to post it and
 * to pull up statistics without touching the panel message.
 */

const PERIOD_CHOICES: { name: string; value: BoardPeriod }[] = [
    { name: 'This week (live)', value: 'thisweek' },
    { name: 'Last week (final)', value: 'lastweek' },
    { name: 'Last 30 days', value: 'month' },
    { name: 'All time', value: 'all' },
];

/** Channels the end-of-week leaderboard may post in. Threads work. */
const ANNOUNCE_CHANNEL_TYPES = [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
] as const;

export const data = new SlashCommandBuilder()
    .setName('timer')
    .setDescription('Independent Training timer.')
    .addSubcommand((sub) =>
        sub
            .setName('panel')
            .setDescription('Post the Trainer Timer control panel in this channel. Club Managers only.'),
    )
    .addSubcommand((sub) =>
        sub
            .setName('stats')
            .setDescription('Show training statistics.')
            .addUserOption((opt) =>
                opt.setName('trainer').setDescription('Whose stats to show (defaults to you)').setRequired(false),
            ),
    )
    .addSubcommand((sub) =>
        sub.setName('specials').setDescription("The whole server's special timer lines: how often, and who found each first. Club Managers only."),
    )
    .addSubcommand((sub) =>
        sub
            .setName('leaderboard')
            .setDescription('Show the training leaderboard.')
            .addStringOption((opt) =>
                opt
                    .setName('period')
                    .setDescription('Time window (defaults to this week, live)')
                    .setRequired(false)
                    .addChoices(...PERIOD_CHOICES),
            ),
    )
    .addSubcommand((sub) =>
        sub
            .setName('rewards')
            .setDescription("Set the weekly roles and where the week's final board posts. Club Managers only.")
            .addRoleOption((opt) => opt.setName('top_role').setDescription(`Role for the week's ${placesLabel('top')} by runs`).setRequired(false))
            .addRoleOption((opt) => opt.setName('second_role').setDescription(`Role for the week's ${placesLabel('second')} by runs`).setRequired(false))
            .addChannelOption((opt) =>
                opt
                    .setName('channel')
                    .setDescription("Where the week's final leaderboard posts. A thread works.")
                    .setRequired(false)
                    .addChannelTypes(...ANNOUNCE_CHANNEL_TYPES),
            )
            .addBooleanOption((opt) =>
                opt.setName('off').setDescription('Stop the weekly role and post. Milestone roles stay.').setRequired(false),
            ),
    )
    .addSubcommand((sub) =>
        sub
            .setName('publish')
            .setDescription("Post last week's final leaderboard now, once. Roles are not changed. Club Managers only.")
            .addChannelOption((opt) =>
                opt
                    .setName('channel')
                    .setDescription('Where to post it (defaults to the rewards channel, else here)')
                    .setRequired(false)
                    .addChannelTypes(...ANNOUNCE_CHANNEL_TYPES),
            )
            .addBooleanOption((opt) => opt.setName('ping').setDescription(`Ping the top ${AWARD_PLACES} (default yes)`).setRequired(false)),
    )
    .addSubcommandGroup((group) =>
        group
            .setName('milestone')
            .setDescription('Roles earned at a number of runs; on a ladder, only the highest is kept. Club Managers only.')
            .addSubcommand((sub) =>
                sub
                    .setName('add')
                    .setDescription('Give a role at a number of runs, including to everyone already past it.')
                    .addIntegerOption((opt) => opt.setName('runs').setDescription('Completed runs, e.g. 100').setRequired(true).setMinValue(1))
                    .addRoleOption((opt) => opt.setName('role').setDescription('Role to give').setRequired(true)),
            )
            .addSubcommand((sub) =>
                sub
                    .setName('remove')
                    .setDescription('Stop giving a milestone role. Trainers who have it keep it.')
                    .addIntegerOption((opt) => opt.setName('runs').setDescription('The milestone, e.g. 100').setRequired(true).setMinValue(1)),
            )
            .addSubcommand((sub) =>
                sub
                    .setName('ladder')
                    .setDescription('On: trainers keep only their highest milestone role. Off: the roles stack.')
                    .addBooleanOption((opt) => opt.setName('on').setDescription('Ladder on (the default) or off').setRequired(true)),
            ),
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) return;

    if (interaction.options.getSubcommandGroup(false) === 'milestone') {
        await handleMilestone(interaction);
        return;
    }
    switch (interaction.options.getSubcommand()) {
        case 'rewards':
            await handleRewards(interaction);
            break;
        case 'publish':
            await handlePublish(interaction);
            break;
        case 'panel':
            await handlePanel(interaction);
            break;
        case 'stats':
            await handleStats(interaction);
            break;
        case 'leaderboard':
            await handleLeaderboard(interaction);
            break;
        case 'specials':
            await handleSpecials(interaction);
            break;
    }
}

/**
 * `/timer specials`: the whole server's tally of special lines, only to the
 * Club Manager who asks. Trainers see their own with the panel's Specials
 * button.
 */
async function handleSpecials(interaction: ChatInputCommandInteraction) {
    if (!isOfficer(interaction.member as GuildMember)) {
        await interaction.reply({
            embeds: [errorEmbed('Only Club Managers can see the whole server\'s specials. Press **Specials** on the Trainer Timer panel to see yours.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const tally = await rareTally(interaction.guildId!);
    await interaction.reply({ ...specialsView(tally, SPECIALS_FIRST_PAGE), allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
}

/** Posts a fresh control panel. */
async function handlePanel(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    if (!isOfficer(member)) {
        await interaction.reply({
            embeds: [errorEmbed('Only Club Managers can post the timer panel.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // The live board and the panel are posted as normal channel messages,
    // not the interaction reply, so they are permanent and can be pinned. An
    // old pair in this channel is deleted, so this also moves it to the bottom.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const posted = await postPanelPair(interaction.client, interaction.guild!, interaction.channelId);
    await interaction.editReply({
        embeds: [
            posted
                ? successEmbed('Panel posted', 'The live leaderboard and the panel are at the bottom. Pin the panel so trainers can find it.')
                : errorEmbed('The panel can only be posted in a text channel I can send messages in.'),
        ],
    });
}

/** Renders a trainer's statistics card. */
async function handleStats(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const guildId = interaction.guildId!;
    const target = interaction.options.getUser('trainer') ?? interaction.user;
    const [stats, series, heatmap] = await Promise.all([
        getTrainerStats(guildId, target.id),
        getDailyRunCounts(guildId, target.id),
        getHourlyHeatmap(guildId, target.id),
    ]);

    const displayName = await resolveDisplayName(interaction, target.id, target.username);
    const buffer = await renderTimerStats(displayName, stats, series, heatmap);

    await interaction.editReply({
        files: [new AttachmentBuilder(buffer, { name: `training-${target.id}.png` })],
    });
}

/** Renders the leaderboard image. */
async function handleLeaderboard(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const period = (interaction.options.getString('period') as BoardPeriod | null) ?? 'thisweek';
    const buffer = await renderBoardFor(interaction.guild!, period);
    await interaction.editReply({
        files: [new AttachmentBuilder(buffer, { name: `training-leaderboard-${period}.png` })],
    });
}

/** Resolves a guild display name, falling back when the member has left. */
function resolveDisplayName(interaction: ChatInputCommandInteraction | ButtonInteraction, userId: string, fallback: string): Promise<string> {
    return displayName(interaction.guild!, userId, fallback);
}

// ─── Rewards ──────────────────────────────────────────────────────────────────

/** Refuses anyone but a Club Manager; true when the caller may change rewards. */
async function requireManager(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (isOfficer(interaction.member as GuildMember)) return true;
    await interaction.reply({ embeds: [errorEmbed('Only Club Managers can change timer rewards.')], flags: MessageFlags.Ephemeral });
    return false;
}

/**
 * `/timer rewards`: sets the weekly role and the board's channel, or with no
 * options shows the setup, when the week ends, and the live top 5.
 */
async function handleRewards(interaction: ChatInputCommandInteraction) {
    if (!(await requireManager(interaction))) return;
    const guild = interaction.guild!;
    const role = interaction.options.getRole('top_role');
    const second = interaction.options.getRole('second_role');
    const channel = interaction.options.getChannel('channel');
    const off = interaction.options.getBoolean('off') ?? false;

    for (const r of [role, second]) {
        if (!r) continue;
        const problem = await roleProblem(guild, r.id);
        if (problem) {
            await interaction.reply({ embeds: [errorEmbed(problem)], flags: MessageFlags.Ephemeral });
            return;
        }
    }
    const changed = off || role !== null || second !== null || channel !== null;
    // The first setup awards last week at the next minute's check.
    const firstSetup = changed && !off && (await getTimerSettings(guild.id)) === null;
    const settings = off
        ? await saveTimerSettings(guild.id, { topRoleId: null, secondRoleId: null, announceChannelId: null })
        : changed
          ? await saveTimerSettings(guild.id, {
                ...(role ? { topRoleId: role.id } : {}),
                ...(second ? { secondRoleId: second.id } : {}),
                ...(channel ? { announceChannelId: channel.id } : {}),
            })
          : await getTimerSettings(guild.id);

    const milestones = await getMilestoneRoles(guild.id);
    const live = (await getBoard(guild.id, 'thisweek', AWARD_PLACES)).rows;
    const ends = Math.floor(nextWeekStart().getTime() / 1000);
    const lines = [
        `Weekly role, ${placesLabel('top')}: ${settings?.topRoleId ? `<@&${settings.topRoleId}>` : 'not set'}`,
        `Weekly role, ${placesLabel('second')}: ${settings?.secondRoleId ? `<@&${settings.secondRoleId}>` : 'not set (`second_role`)'}`,
        `End-of-week board: ${settings?.announceChannelId ? `<#${settings.announceChannelId}>` : 'not posted'}`,
        `This week ends <t:${ends}:F> (<t:${ends}:R>); it is awarded about 15 minutes later.`,
        ...(firstSetup
            ? [
                  settings?.announceChannelId
                      ? 'Last week is awarded within a minute, and its final board posts in that channel.'
                      : 'Last week is awarded within a minute. Set a channel in the same command next time to have its board posted.',
              ]
            : []),
        '',
        `Live top ${AWARD_PLACES}: ${live.length > 0 ? live.map((r, i) => `${i + 1}. <@${r.discordUserId}> (${r.runs})`).join(' · ') : 'no runs yet this week'}`,
        '',
        `Milestones: ${milestones.length > 0 ? milestones.map((m) => `${m.runs} runs → <@&${m.roleId}>`).join(' · ') : 'none yet (`/timer milestone add`)'}`,
    ];
    // Mentions inside an embed never ping.
    await interaction.reply({ embeds: [(changed ? successEmbed : infoEmbed)('Timer rewards', lines.join('\n'))], flags: MessageFlags.Ephemeral });
}

/**
 * `/timer publish`: posts last week's final board once, on demand, in the
 * chosen channel, else the rewards channel, else here. It only posts: the
 * weekly role is given by the Monday award, not by this.
 */
async function handlePublish(interaction: ChatInputCommandInteraction) {
    if (!(await requireManager(interaction))) return;
    const guild = interaction.guild!;
    const picked = interaction.options.getChannel('channel');
    const ping = interaction.options.getBoolean('ping') ?? true;
    const settings = await getTimerSettings(guild.id);
    const channelId = picked?.id ?? settings?.announceChannelId ?? interaction.channelId;
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) {
        await interaction.reply({ embeds: [errorEmbed(`I cannot post in <#${channelId}>. Check that I can see it and send messages there.`)], flags: MessageFlags.Ephemeral });
        return;
    }
    // Rendering the board can take a moment.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const week = shiftKey(weekKey(new Date()), -7);
    try {
        await channel.send(await weekResultsPost(guild, week, ping));
    } catch (e) {
        console.error('Timer publish failed:', e);
        await interaction.editReply({ embeds: [errorEmbed(`Posting in <#${channelId}> failed. Check that I can send messages and attach files there.`)] });
        return;
    }
    // Keep the timer panel below the results when they share a channel.
    await keepPanelAtBottom(interaction.client, guild, channelId).catch((e) => console.error('Timer panel repost failed:', e));
    await interaction.editReply({ embeds: [successEmbed('Published', `Posted the final board for ${weekLabel(week)} in <#${channelId}>${ping ? `, pinging the top ${AWARD_PLACES}` : ''}.`)] });
}

/** The guild's milestones as one line: "50 → @Veteran · 150 → @Ace". */
async function ladderLine(guildId: string): Promise<string> {
    const milestones = await getMilestoneRoles(guildId);
    return milestones.length > 0 ? milestones.map((m) => `**${m.runs}** → <@&${m.roleId}>`).join(' · ') : 'none';
}

/** What the ladder setting means, for the replies. */
function ladderNote(ladder: boolean): string {
    return ladder
        ? '-# Ladder on: trainers keep only their highest milestone role; reaching the next one swaps it.'
        : '-# Ladder off: milestone roles stack, and trainers keep every one they reach.';
}

/** `/timer milestone add|remove|ladder`. */
async function handleMilestone(interaction: ChatInputCommandInteraction) {
    if (!(await requireManager(interaction))) return;
    const guild = interaction.guild!;
    const sub = interaction.options.getSubcommand();

    if (sub === 'ladder') {
        const on = interaction.options.getBoolean('on', true);
        // Re-sorting everyone's roles can take a moment.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await prisma.timerMilestoneSettings.upsert({ where: { guildId: guild.id }, create: { guildId: guild.id, ladder: on }, update: { ladder: on } });
        const sync = await syncMilestones(guild);
        const changed = on
            ? `${sync.removed} lower milestone role${sync.removed === 1 ? '' : 's'} taken off, so everyone holds only their highest.`
            : `${sync.given} trainer${sync.given === 1 ? '' : 's'} got back the milestone roles they had passed.`;
        await interaction.editReply({
            embeds: [successEmbed(on ? 'Ladder on' : 'Ladder off', [changed, '', `**Milestones:** ${await ladderLine(guild.id)}`, ladderNote(on)].join('\n'))],
        });
        return;
    }

    const runs = interaction.options.getInteger('runs', true);
    if (sub === 'remove') {
        const removed = await prisma.timerMilestoneRole.deleteMany({ where: { guildId: guild.id, runs } });
        await interaction.reply({
            embeds: [
                removed.count > 0
                    ? successEmbed(
                          'Milestone removed',
                          [`Nothing is given at **${runs}** runs any more. Trainers who hold that role keep it.`, '', `**Milestones:** ${await ladderLine(guild.id)}`].join('\n'),
                      )
                    : errorEmbed(`There is no milestone at ${runs} runs.`),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const role = interaction.options.getRole('role', true);
    const problem = await roleProblem(guild, role.id);
    if (problem) {
        await interaction.reply({ embeds: [errorEmbed(problem)], flags: MessageFlags.Ephemeral });
        return;
    }
    // Giving it to everyone already past it can take a moment.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await prisma.timerMilestoneRole.upsert({
        where: { guildId_runs: { guildId: guild.id, runs } },
        create: { guildId: guild.id, runs, roleId: role.id },
        update: { roleId: role.id },
    });
    const ladder = await milestoneLadder(guild.id);
    const sync = await syncMilestones(guild);
    const now =
        sync.given === 0
            ? `Nobody has reached ${runs} runs yet. The first to get there earns it on the spot.`
            : `${sync.given} trainer${sync.given === 1 ? ' has' : 's have'} already passed ${runs} runs and got it now. Everyone else earns it the moment they reach it.`;
    const swapped = ladder && sync.removed > 0 ? ` ${sync.removed} lower role${sync.removed === 1 ? ' was' : 's were'} taken off on the way up.` : '';
    await interaction.editReply({
        embeds: [
            successEmbed(
                'Milestone set',
                [`<@&${role.id}> is earned at **${runs}** runs.`, now + swapped, '', `**Milestones:** ${await ladderLine(guild.id)}`, ladderNote(ladder)].join('\n'),
            ),
        ],
    });
}

// ─── Panel buttons ────────────────────────────────────────────────────────────

/** True when this button belongs to the timer panel. */
export function isTimerButton(customId: string): boolean {
    return customId.startsWith('timer:');
}

/**
 * Handles a press on the timer panel.
 *
 * Buttons are routed by custom ID rather than by a message component collector,
 * so a panel keeps working after the bot restarts. A collector would be bound
 * to a process that no longer exists.
 */
export async function handleTimerButton(interaction: ButtonInteraction) {
    if (!interaction.inGuild()) return;

    const guildId = interaction.guildId!;

    // A setting flipped on the Settings screen: redraw it in place.
    if (interaction.customId.startsWith(SETTINGS_PREFIX)) {
        const settings = await toggleSetting(guildId, interaction.user.id, interaction.customId.slice(SETTINGS_PREFIX.length));
        await interaction.update(settingsView(settings));
        return;
    }

    // The Boosts view's On/Off: flip it and redraw the view in place.
    if (interaction.customId === BOOSTS_TOGGLE_ID) {
        await toggleSetting(guildId, interaction.user.id, 'boosts');
        await interaction.update(await boostsView(guildId, interaction.user.id));
        return;
    }

    // Back/Next in a Specials list: the trainer's own (`mine`), or the
    // server's (`all`, Club Managers only, as for /timer specials).
    if (interaction.customId.startsWith(SPECIALS_PAGE_PREFIX)) {
        const [mode, page] = interaction.customId.slice(SPECIALS_PAGE_PREFIX.length).split(':');
        if (mode === 'all') {
            if (!isOfficer(interaction.member as GuildMember)) {
                await interaction.reply({ content: 'Only Club Managers can see the whole server\'s specials.', flags: MessageFlags.Ephemeral });
                return;
            }
            await interaction.update({ ...specialsView(await rareTally(guildId), Number(page)), allowedMentions: { parse: [] } });
        } else {
            await interaction.update({ ...(await mySpecialsView(guildId, interaction.user.id, Number(page))), allowedMentions: { parse: [] } });
        }
        return;
    }

    // A set's On/Off on the trainer's own Specials page. A locked set's
    // button is disabled; a forged press on one changes nothing.
    if (interaction.customId.startsWith(SPECIALS_SET_PREFIX)) {
        const setId = interaction.customId.slice(SPECIALS_SET_PREFIX.length);
        if (!(await lockedSetsFor(guildId, interaction.user.id)).includes(setId)) await toggleSetting(guildId, interaction.user.id, `set:${setId}`);
        await interaction.update({ ...(await mySpecialsView(guildId, interaction.user.id, pageOfSet(setId))), allowedMentions: { parse: [] } });
        return;
    }

    switch (interaction.customId) {
        case BUTTON_SETTINGS: {
            await interaction.reply({ ...settingsView(await getUserSettings(guildId, interaction.user.id)), flags: MessageFlags.Ephemeral });
            break;
        }

        case BUTTON_BOOSTS: {
            await interaction.reply({ ...(await boostsView(guildId, interaction.user.id)), flags: MessageFlags.Ephemeral });
            break;
        }

        case BUTTON_SPECIALS: {
            // The same hidden list as /timer specials: your own finds only.
            await interaction.reply({ ...(await mySpecialsView(guildId, interaction.user.id, SPECIALS_FIRST_PAGE)), allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
            break;
        }

        case BUTTON_START: {
            const settings = await getUserSettings(guildId, interaction.user.id);
            const minutes = runMinutes(settings);
            const { timer, wasReset } = await startTimer(
                guildId,
                interaction.channelId,
                interaction.message.id,
                interaction.user.id,
                minutes,
                settings.earlyRiser,
            );

            const endsAt = `<t:${Math.floor(timer.expiresAt.getTime() / 1000)}:R>`;
            const early =
                !wasReset && timer.earlyStart && settings.boosts
                    ? `\n**Early start!** This run's ping has +${EARLY_START.chance * 100}% special chance.`
                    : '';
            await interaction.reply({
                content: wasReset
                    ? `Timer reset. Your ${minutes}-minute run now ends ${endsAt}.`
                    : `Timer started. Your ${minutes}-minute run ends ${endsAt}.${early}`,
                flags: MessageFlags.Ephemeral,
            });
            await refreshFromInteraction(interaction, guildId);
            break;
        }

        case BUTTON_STOP: {
            const stopped = await stopTimer(guildId, interaction.user.id);
            await interaction.reply({
                content: stopped
                    ? 'Timer cancelled. It will not count as a completed run.'
                    : 'You do not have a timer running.',
                flags: MessageFlags.Ephemeral,
            });
            if (stopped) await refreshFromInteraction(interaction, guildId);
            break;
        }

        case BUTTON_STATS: {
            // Ephemeral so a busy panel is not buried under stat cards.
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const [stats, series, heatmap] = await Promise.all([
                getTrainerStats(guildId, interaction.user.id),
                getDailyRunCounts(guildId, interaction.user.id),
                getHourlyHeatmap(guildId, interaction.user.id),
            ]);
            const displayName = await resolveDisplayName(interaction, interaction.user.id, interaction.user.username);
            const buffer = await renderTimerStats(displayName, stats, series, heatmap);
            await interaction.editReply({
                files: [new AttachmentBuilder(buffer, { name: 'training-stats.png' })],
            });
            break;
        }

        case BUTTON_LEADERBOARD: {
            // This week is on the live board above the panel already, so the
            // button shows what it does not: last week's final standings, all
            // time, and the specials board.
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const [lastWeek, allTime, specials] = await Promise.all([
                renderBoardFor(interaction.guild!, 'lastweek'),
                renderBoardFor(interaction.guild!, 'all'),
                renderSpecialsBoardFor(interaction.guild!),
            ]);
            await interaction.editReply({
                files: [
                    new AttachmentBuilder(lastWeek, { name: 'training-last-week.png' }),
                    new AttachmentBuilder(allTime, { name: 'training-all-time.png' }),
                    new AttachmentBuilder(specials, { name: 'specials-leaderboard.png' }),
                ],
            });
            break;
        }
    }
}

/** Rewrites the panel the button was pressed on, with current data. */
async function refreshFromInteraction(interaction: ButtonInteraction, guildId: string) {
    const [timers, context] = await Promise.all([listActiveTimers(guildId), getPanelContext(guildId)]);
    await refreshPanel(interaction.client, interaction.channelId, interaction.message.id, timers, context);
}

/** True for the "Read a special" menu under a trainer's Specials list. */
export function isSpecialReadMenu(customId: string): boolean {
    return customId === READ_MENU_ID;
}

/** Shows the chosen special in full, only to the trainer, if they unlocked it. */
export async function handleSpecialRead(interaction: StringSelectMenuInteraction) {
    if (!interaction.inGuild()) return;
    const special = await readSpecial(interaction.guildId, interaction.user.id, interaction.values[0] ?? '');
    await interaction.reply({
        ...(special ? { embeds: [specialEmbed(special)] } : { content: 'You have not unlocked that special yet.' }),
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
    });
}
