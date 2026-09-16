import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    ButtonInteraction,
    MessageFlags,
    AttachmentBuilder,
    GuildMember,
} from 'discord.js';
import { isOfficer } from '../lib/permissions';
import { errorEmbed, successEmbed } from '../lib/embeds';
import {
    BUTTON_LEADERBOARD,
    BUTTON_START,
    BUTTON_STATS,
    BUTTON_STOP,
    buildPanel,
    refreshPanel,
} from '../lib/timer/panel';
import {
    TRAINING_MINUTES,
    getDailyRunCounts,
    getLeaderboard,
    getPanelContext,
    getTrainerStats,
    listActiveTimers,
    startTimer,
    stopTimer,
    type LeaderboardPeriod,
} from '../lib/timer/service';
import { renderTimerStats } from '../lib/image/renderTimerStats';
import { renderTimerLeaderboard } from '../lib/image/renderTimerLeaderboard';

/**
 * Independent Training timer commands and panel buttons.
 *
 * The panel is the primary interface; the slash commands exist to post it and
 * to pull up statistics without touching the panel message.
 */

const PERIOD_CHOICES: { name: string; value: LeaderboardPeriod }[] = [
    { name: 'Last 7 days', value: 'week' },
    { name: 'Last 30 days', value: 'month' },
    { name: 'All time', value: 'all' },
];

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
        sub
            .setName('leaderboard')
            .setDescription('Show the training leaderboard.')
            .addStringOption((opt) =>
                opt
                    .setName('period')
                    .setDescription('Time window (defaults to last 7 days)')
                    .setRequired(false)
                    .addChoices(...PERIOD_CHOICES),
            ),
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) return;

    switch (interaction.options.getSubcommand()) {
        case 'panel':
            await handlePanel(interaction);
            break;
        case 'stats':
            await handleStats(interaction);
            break;
        case 'leaderboard':
            await handleLeaderboard(interaction);
            break;
    }
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

    const guildId = interaction.guildId!;
    const [timers, context] = await Promise.all([listActiveTimers(guildId), getPanelContext(guildId)]);

    // Sent as a normal channel message rather than the interaction reply so it
    // is permanent and can be pinned; interaction replies expire.
    const channel = interaction.channel;
    if (!channel?.isTextBased() || !('send' in channel)) {
        await interaction.reply({
            embeds: [errorEmbed('The panel can only be posted in a text channel.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // The panel's own message ID is not stored here. A button press carries it
    // on `interaction.message.id`, which is how refreshes find the panel, so
    // any number of panels can coexist and each refreshes itself.
    await channel.send(buildPanel(timers, context));
    await interaction.reply({
        embeds: [successEmbed('Panel posted', 'Pin it so trainers can find it easily.')],
        flags: MessageFlags.Ephemeral,
    });
}

/** Renders a trainer's statistics card. */
async function handleStats(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const guildId = interaction.guildId!;
    const target = interaction.options.getUser('trainer') ?? interaction.user;
    const [stats, series] = await Promise.all([
        getTrainerStats(guildId, target.id),
        getDailyRunCounts(guildId, target.id),
    ]);

    const displayName = await resolveDisplayName(interaction, target.id, target.username);
    const buffer = await renderTimerStats(displayName, stats, series);

    await interaction.editReply({
        files: [new AttachmentBuilder(buffer, { name: `training-${target.id}.png` })],
    });
}

/** Renders the leaderboard image. */
async function handleLeaderboard(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const guildId = interaction.guildId!;
    const period = (interaction.options.getString('period') as LeaderboardPeriod | null) ?? 'week';
    const rows = await getLeaderboard(guildId, period);

    const names = new Map<string, string>();
    for (const row of rows) {
        names.set(row.discordUserId, await resolveDisplayName(interaction, row.discordUserId, 'Unknown Trainer'));
    }

    const buffer = await renderTimerLeaderboard(rows, names, period);
    await interaction.editReply({
        files: [new AttachmentBuilder(buffer, { name: `training-leaderboard-${period}.png` })],
    });
}

/** Resolves a guild display name, falling back when the member has left. */
async function resolveDisplayName(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    userId: string,
    fallback: string,
): Promise<string> {
    try {
        const member = await interaction.guild!.members.fetch(userId);
        return member.displayName;
    } catch {
        return fallback;
    }
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

    switch (interaction.customId) {
        case BUTTON_START: {
            const { timer, wasReset } = await startTimer(
                guildId,
                interaction.channelId,
                interaction.message.id,
                interaction.user.id,
            );

            const endsAt = `<t:${Math.floor(timer.expiresAt.getTime() / 1000)}:R>`;
            await interaction.reply({
                content: wasReset
                    ? `Timer reset. Your ${TRAINING_MINUTES}-minute run now ends ${endsAt}.`
                    : `Timer started. Your ${TRAINING_MINUTES}-minute run ends ${endsAt}.`,
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
            const [stats, series] = await Promise.all([
                getTrainerStats(guildId, interaction.user.id),
                getDailyRunCounts(guildId, interaction.user.id),
            ]);
            const displayName = await resolveDisplayName(interaction, interaction.user.id, interaction.user.username);
            const buffer = await renderTimerStats(displayName, stats, series);
            await interaction.editReply({
                files: [new AttachmentBuilder(buffer, { name: 'training-stats.png' })],
            });
            break;
        }

        case BUTTON_LEADERBOARD: {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const rows = await getLeaderboard(guildId, 'week');
            const names = new Map<string, string>();
            for (const row of rows) {
                names.set(row.discordUserId, await resolveDisplayName(interaction, row.discordUserId, 'Unknown Trainer'));
            }
            const buffer = await renderTimerLeaderboard(rows, names, 'week');
            await interaction.editReply({
                files: [new AttachmentBuilder(buffer, { name: 'training-leaderboard.png' })],
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
