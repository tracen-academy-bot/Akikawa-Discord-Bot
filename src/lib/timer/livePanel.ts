import { AttachmentBuilder, type Client, type Guild } from 'discord.js';
import { prisma } from '../../db/prisma';
import { LIVE_DAY_ROWS, LIVE_WEEK_ROWS, renderLiveBoard } from '../image/renderTimerLeaderboard';
import { displayName } from './boardImage';
import { buildPanel } from './panel';
import { getBoard, getDayBoard, getTimerSettings } from './rewards';
import { STREAK_TIMEZONE, getPanelContext, listActiveTimers } from './service';

/**
 * The timer panel and the live leaderboard above it, kept together at the
 * bottom of their channel.
 *
 * `postPanelPair` deletes a channel's old pair (from `TimerPanel`) and posts a
 * fresh one, so `/timer panel`, the weekly results post and `/timer publish`
 * all leave the pair at the bottom. The board is redrawn after runs finish,
 * at most once every `BOARD_REFRESH_MS` per channel, and at the start of each
 * day so "today" resets.
 */

/** Least time between two redraws of one channel's live board. */
const BOARD_REFRESH_MS = 30_000;

/** Guilds whose boards need redrawing; cleared once every board is redrawn. */
const dirtyGuilds = new Set<string>();
/** When each channel's board was last drawn. */
const lastDrawn = new Map<string, number>();

/** "Mon Oct 26" and "12:34 JST" (or the time zone's name) for `now`. */
function labels(now: Date): { dayLabel: string; updatedLabel: string } {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: STREAK_TIMEZONE })
        .format(now)
        .replace(',', '');
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: STREAK_TIMEZONE }).format(now);
    return { dayLabel: day, updatedLabel: `${time} ${STREAK_TIMEZONE === 'Asia/Tokyo' ? 'JST' : STREAK_TIMEZONE}` };
}

/** The live board image for a guild as an attachment. */
export async function liveBoardFile(guild: Guild, now = new Date()): Promise<AttachmentBuilder> {
    const [week, today, settings] = await Promise.all([
        getBoard(guild.id, 'thisweek', LIVE_WEEK_ROWS, now),
        getDayBoard(guild.id, LIVE_DAY_ROWS, now),
        getTimerSettings(guild.id),
    ]);
    const names = new Map<string, string>();
    for (const row of [...week.rows, ...today.rows]) {
        if (!names.has(row.discordUserId)) names.set(row.discordUserId, await displayName(guild, row.discordUserId));
    }
    const role = settings?.topRoleId ? guild.roles.cache.get(settings.topRoleId) : undefined;
    const image = await renderLiveBoard(week, today, names, { topRoleName: role?.name ?? null, ...labels(now) });
    return new AttachmentBuilder(image, { name: 'training-live.png' });
}

/** A text channel the bot can post in, or null. */
async function sendable(client: Client, channelId: string) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    return channel?.isTextBased() && 'send' in channel ? channel : null;
}

/**
 * Posts a fresh live board and panel at the bottom of `channelId`, deleting
 * the old pair there if there is one. Returns false when the channel cannot
 * be posted in.
 */
export async function postPanelPair(client: Client, guild: Guild, channelId: string): Promise<boolean> {
    const channel = await sendable(client, channelId);
    if (!channel) return false;

    const old = await prisma.timerPanel.findUnique({ where: { channelId } });
    if (old) {
        for (const id of [old.boardMessageId, old.panelMessageId]) {
            if (id) await channel.messages.delete(id).catch(() => undefined);
        }
    }

    // The board goes first so it sits just above the panel.
    const board = await channel.send({ files: [await liveBoardFile(guild)] }).catch((e) => {
        console.error('Timer live board post failed:', e);
        return null;
    });
    const [timers, context] = await Promise.all([listActiveTimers(guild.id), getPanelContext(guild.id)]);
    const panel = await channel.send(buildPanel(timers, context));
    await prisma.timerPanel.upsert({
        where: { channelId },
        create: { channelId, guildId: guild.id, panelMessageId: panel.id, boardMessageId: board?.id ?? null },
        update: { panelMessageId: panel.id, boardMessageId: board?.id ?? null },
    });
    lastDrawn.set(channelId, Date.now());
    return true;
}

/** The panel message currently in a channel, if the bot is keeping one there. */
export async function currentPanelMessageId(channelId: string): Promise<string | null> {
    return (await prisma.timerPanel.findUnique({ where: { channelId } }))?.panelMessageId ?? null;
}

/** Re-posts the pair in `channelId` if one is kept there, so it stays below a post just made. */
export async function keepPanelAtBottom(client: Client, guild: Guild, channelId: string): Promise<void> {
    if (await prisma.timerPanel.findUnique({ where: { channelId } })) await postPanelPair(client, guild, channelId);
}

/** Marks a guild's live boards for redrawing, e.g. after a run finishes. */
export function markLiveBoardsDirty(guildId: string): void {
    dirtyGuilds.add(guildId);
}

/** Marks every live board for redrawing now, throttle aside: a new day has begun. */
export async function markAllLiveBoardsDirty(): Promise<void> {
    for (const panel of await prisma.timerPanel.findMany({ select: { guildId: true, channelId: true } })) {
        dirtyGuilds.add(panel.guildId);
        lastDrawn.delete(panel.channelId);
    }
}

/**
 * Redraws the live boards of dirty guilds whose last redraw is old enough.
 * A guild stays dirty until all its boards are redrawn, so a run finishing
 * inside the throttle still shows on the next pass.
 */
export async function flushLiveBoards(client: Client, now = Date.now()): Promise<void> {
    for (const guildId of [...dirtyGuilds]) {
        const panels = await prisma.timerPanel.findMany({ where: { guildId } });
        const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
        if (!guild) {
            dirtyGuilds.delete(guildId);
            continue;
        }
        let waiting = false;
        for (const panel of panels) {
            if (!panel.boardMessageId) continue;
            if (now - (lastDrawn.get(panel.channelId) ?? 0) < BOARD_REFRESH_MS) {
                waiting = true;
                continue;
            }
            lastDrawn.set(panel.channelId, now);
            try {
                const channel = await sendable(client, panel.channelId);
                const message = await channel?.messages.fetch(panel.boardMessageId);
                await message?.edit({ files: [await liveBoardFile(guild)], attachments: [] });
            } catch (e) {
                // Deleted by hand, or the channel is gone; the next /timer panel posts a new one.
                console.error(`Timer live board refresh failed in ${panel.channelId}:`, e instanceof Error ? e.message : e);
            }
        }
        if (!waiting) dirtyGuilds.delete(guildId);
    }
}
