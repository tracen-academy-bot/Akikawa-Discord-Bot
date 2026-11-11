import { AttachmentBuilder, type Client, type Guild, type Message } from 'discord.js';
import { prisma } from '../../db/prisma';
import { LIVE_DAY_ROWS, LIVE_WEEK_ROWS, renderLiveBoard } from '../image/renderTimerLeaderboard';
import { displayName } from './boardImage';
import { buildPanel } from './panel';
import { getBoard, getDayBoard, getTimerSettings } from './rewards';
import { STREAK_TIMEZONE, getPanelContext, listActiveTimers } from './service';

/**
 * The timer's sticky: the live leaderboard, the panel under it, and the
 * channel's notice (`/timer notice`) under that, kept together at the bottom
 * of their channel.
 *
 * `postPanelPair` deletes a channel's old sticky (from `TimerPanel`) and
 * posts a fresh one, so `/timer panel`, the weekly results post and
 * `/timer publish` all leave it at the bottom. When anyone else posts in the
 * channel, the sticky moves back under them once the channel is quiet (see
 * `restoreSticky`); timer pings are the exception and stay below it. The
 * board is redrawn after runs finish, at most once every `BOARD_REFRESH_MS`
 * per channel, and at the start of each day so "today" resets.
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
    const top = settings?.topRoleId ? guild.roles.cache.get(settings.topRoleId) : undefined;
    const second = settings?.secondRoleId ? guild.roles.cache.get(settings.secondRoleId) : undefined;
    const image = await renderLiveBoard(week, today, names, { topRoleName: top?.name ?? null, secondRoleName: second?.name ?? null, ...labels(now) });
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
        for (const id of [old.boardMessageId, old.panelMessageId, old.noticeMessageId]) {
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
    // The notice goes last, right under the panel. It never pings: it is re-posted often.
    const notice = old?.notice
        ? await channel.send({ content: old.notice, allowedMentions: { parse: [] } }).catch((e) => {
              console.error('Timer notice post failed:', e);
              return null;
          })
        : null;
    await prisma.timerPanel.upsert({
        where: { channelId },
        create: { channelId, guildId: guild.id, panelMessageId: panel.id, boardMessageId: board?.id ?? null },
        update: { panelMessageId: panel.id, boardMessageId: board?.id ?? null, noticeMessageId: notice?.id ?? null },
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

/** Longest notice: one Discord message. */
export const NOTICE_MAX_LENGTH = 2000;

/**
 * Sets the notice under the panel in `channelId` (`text`), or removes it
 * (null or empty). An existing notice message is edited in place; otherwise
 * the sticky is re-posted so the notice sits right under the panel.
 * 'no-panel' when the bot keeps no panel there.
 */
export async function setPanelNotice(
    client: Client,
    guild: Guild,
    channelId: string,
    text: string | null,
): Promise<'saved' | 'removed' | 'no-panel' | 'failed'> {
    const panel = await prisma.timerPanel.findUnique({ where: { channelId } });
    if (!panel) return 'no-panel';
    const channel = await sendable(client, channelId);
    if (!channel) return 'failed';
    const notice = text?.trim() ? text.trim().slice(0, NOTICE_MAX_LENGTH) : null;
    if (!notice) {
        if (panel.noticeMessageId) await channel.messages.delete(panel.noticeMessageId).catch(() => undefined);
        await prisma.timerPanel.update({ where: { channelId }, data: { notice: null, noticeMessageId: null } });
        return 'removed';
    }
    await prisma.timerPanel.update({ where: { channelId }, data: { notice } });
    if (panel.noticeMessageId) {
        try {
            const message = await channel.messages.fetch(panel.noticeMessageId);
            await message.edit({ content: notice, allowedMentions: { parse: [] } });
            return 'saved';
        } catch {
            // Deleted by hand: post the sticky again, notice included.
        }
    }
    return (await postPanelPair(client, guild, channelId)) ? 'saved' : 'failed';
}

// ─── Sticky ───────────────────────────────────────────────────────────────────

/** The sticky moves down once the channel has been quiet this long... */
export const STICKY_QUIET_MS = 30_000;
/** ...or this long after the first post above it, if the chat never pauses. */
export const STICKY_MAX_WAIT_MS = 180_000;

/** A pending move per channel: its timeout and when the first post came in. */
const stickyTimers = new Map<string, { timer: NodeJS.Timeout; since: number }>();
/** Channels whose sticky is being re-posted right now. */
const restoring = new Set<string>();

/** How long to wait before moving the sticky, the first post above it having come at `since`. */
export function stickyDelay(since: number, now: number): number {
    return Math.max(0, Math.min(STICKY_QUIET_MS, since + STICKY_MAX_WAIT_MS - now));
}

/**
 * What to do with a sticky, given the messages posted after it (`newer`, by
 * id) and the ids of the timer pings still up (`livePings`):
 *
 *   none     nothing is under it; it is at the bottom
 *   wait     a ping is still up under it: pings stay at the bottom, so the
 *            sticky moves once the ping is deleted (that checks again)
 *   repost   only other messages are under it: move it below them
 */
export function stickyAction(newer: readonly string[], livePings: ReadonlySet<string>): 'none' | 'wait' | 'repost' {
    if (newer.length === 0) return 'none';
    return newer.some((id) => livePings.has(id)) ? 'wait' : 'repost';
}

/**
 * Something happened in `channelId` that may have left the sticky above other
 * messages: check it once the channel has been quiet (`stickyDelay`). Each
 * new call pushes the check back, up to `STICKY_MAX_WAIT_MS`.
 */
export function noteChannelActivity(client: Client, channelId: string, now = Date.now()): void {
    const pending = stickyTimers.get(channelId);
    const since = pending?.since ?? now;
    if (pending) clearTimeout(pending.timer);
    const timer = setTimeout(() => {
        stickyTimers.delete(channelId);
        void restoreSticky(client, channelId).catch((e) => console.error(`Timer sticky move failed in ${channelId}:`, e instanceof Error ? e.message : e));
    }, stickyDelay(since, now));
    timer.unref?.();
    stickyTimers.set(channelId, { timer, since });
}

/** messageCreate: a post by anyone but the bot, in a channel with a sticky, schedules a check. */
export async function onChannelMessage(message: Message): Promise<void> {
    if (!message.inGuild() || message.author.id === message.client.user.id) return;
    if (!(await prisma.timerPanel.findUnique({ where: { channelId: message.channelId }, select: { channelId: true } }))) return;
    noteChannelActivity(message.client, message.channelId);
}

/**
 * Moves the sticky in `channelId` back to the bottom if other messages are
 * under it (see `stickyAction`). Returns what it decided.
 */
export async function restoreSticky(client: Client, channelId: string): Promise<'none' | 'wait' | 'repost' | 'skip'> {
    if (restoring.has(channelId)) {
        // A move is under way; look again after it.
        noteChannelActivity(client, channelId);
        return 'skip';
    }
    restoring.add(channelId);
    try {
        const panel = await prisma.timerPanel.findUnique({ where: { channelId } });
        if (!panel) return 'skip';
        const channel = await sendable(client, channelId);
        if (!channel) return 'skip';
        const last = panel.noticeMessageId ?? panel.panelMessageId;
        const newer = [...(await channel.messages.fetch({ after: last, limit: 50 })).keys()];
        const pings = await prisma.timerNotification.findMany({ where: { channelId, messageId: { in: newer } }, select: { messageId: true } });
        const action = stickyAction(newer, new Set(pings.map((p) => p.messageId)));
        if (action === 'repost') {
            const guild = client.guilds.cache.get(panel.guildId) ?? (await client.guilds.fetch(panel.guildId).catch(() => null));
            if (guild) await postPanelPair(client, guild, channelId);
        }
        return action;
    } finally {
        restoring.delete(channelId);
    }
}

/** On startup: check every sticky, for posts made while the bot was offline. */
export async function checkAllStickies(client: Client): Promise<void> {
    for (const panel of await prisma.timerPanel.findMany({ select: { channelId: true } })) noteChannelActivity(client, panel.channelId);
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
