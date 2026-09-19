import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    type Client,
} from 'discord.js';
import type { TrainingTimer } from '@prisma/client';
import { COLORS } from '../embeds';
import { TRAINING_MINUTES } from './service';

/**
 * The Trainer Timer control panel: a single persistent message carrying the
 * live roster and the buttons that drive it.
 *
 * Countdowns use Discord's relative timestamp markup (`<t:unix:R>`), which each
 * client renders and ticks locally. That keeps the roster live without the bot
 * editing the message on a schedule, so the panel only needs rewriting when the
 * roster actually changes.
 */

/** Button IDs. Routed by ID rather than by collector so they survive restarts. */
export const BUTTON_START = 'timer:start';
export const BUTTON_STOP = 'timer:stop';
export const BUTTON_STATS = 'timer:stats';
export const BUTTON_LEADERBOARD = 'timer:leaderboard';

/** Roster entries shown before the list is truncated. */
const MAX_ROSTER_ROWS = 20;

/** Renders a Date as a Discord relative timestamp, e.g. "in 48 minutes". */
function relativeTimestamp(date: Date): string {
    return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

/** Contextual numbers shown under the roster to make progress visible. */
export interface PanelContext {
    /** Runs completed across the whole guild today. */
    runsToday: number;
    /** Trainer with the most runs today, if anyone has trained. */
    topToday: { discordUserId: string; runs: number } | null;
}

/** Builds the panel embed and its button row. */
export function buildPanel(timers: TrainingTimer[], context: PanelContext) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('Trainer Timer')
        .setDescription(
            `Umamusume Global Independent Training timer.\n` +
                `Press **Start** to begin a ${TRAINING_MINUTES}-minute run, or press it again to reset.`,
        );

    if (timers.length === 0) {
        embed.addFields({ name: 'Active Trainers', value: 'Nobody is training right now.' });
    } else {
        const shown = timers.slice(0, MAX_ROSTER_ROWS);
        const rows = shown.map((t) => `<@${t.discordUserId}> — ${relativeTimestamp(t.expiresAt)}`);
        if (timers.length > shown.length) {
            rows.push(`*…and ${timers.length - shown.length} more.*`);
        }
        embed.addFields({
            name: `Active Trainers (${timers.length})`,
            value: rows.join('\n'),
        });
    }

    const progress = [`**${context.runsToday}** run${context.runsToday === 1 ? '' : 's'} completed today`];
    if (context.topToday) {
        progress.push(`Leading today: <@${context.topToday.discordUserId}> (${context.topToday.runs})`);
    }
    embed.addFields({ name: 'Today', value: progress.join('\n') });

    embed.setTimestamp();

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(BUTTON_START).setLabel('Start').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(BUTTON_STOP).setLabel('Stop').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(BUTTON_STATS).setLabel('My Stats').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(BUTTON_LEADERBOARD).setLabel('Leaderboard').setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [buttons] };
}

/**
 * Rewrites an existing panel message in place.
 *
 * Panels are long-lived and may outlive the channel or message they point at,
 * so every failure here is swallowed: a stale panel reference must never break
 * the action that triggered the refresh (starting a run, or delivering a ping).
 */
export async function refreshPanel(
    client: Client,
    channelId: string,
    messageId: string,
    timers: TrainingTimer[],
    context: PanelContext,
): Promise<void> {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) return;

        const message = await channel.messages.fetch(messageId);
        await message.edit(buildPanel(timers, context));
    } catch {
        // Panel deleted, channel gone, or permissions revoked. Not fatal.
    }
}
