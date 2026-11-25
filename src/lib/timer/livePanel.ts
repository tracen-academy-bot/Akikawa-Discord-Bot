import { AttachmentBuilder, type Client, type Guild, type Message } from 'discord.js';
import { prisma } from '../../db/prisma';
import { LIVE_DAY_ROWS, LIVE_WEEK_ROWS, renderLiveBoard } from '../image/renderTimerLeaderboard';
import { displayName } from './boardImage';
import { buildPanel } from './panel';
import { noticeBox } from './pingBox';
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
    const third = settings?.thirdRoleId ? guild.roles.cache.get(settings.thirdRoleId) : undefined;
    const image = await renderLiveBoard(week, today, names, { topRoleName: top?.name ?? null, secondRoleName: second?.name ?? null, thirdRoleName: third?.name ?? null, ...labels(now) });
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
        ? await channel.send(noticeBox(old.notice)).catch((e) => {
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

/**
 * Takes the sticky out of `channelId` (`/timer panel remove:true`): deletes
 * its board, panel and notice messages and forgets the channel, so nothing
 * is reposted or set there again. False when there was no panel.
 */
export async function removePanel(client: Client, channelId: string): Promise<boolean> {
    const panel = await prisma.timerPanel.findUnique({ where: { channelId } });
    if (!panel) return false;
    const channel = await sendable(client, channelId);
    if (channel) {
        for (const id of [panel.boardMessageId, panel.panelMessageId, panel.noticeMessageId]) {
            if (id) await channel.messages.delete(id).catch(() => undefined);
        }
    }
    await prisma.timerPanel.delete({ where: { channelId } });
    lastDrawn.delete(channelId);
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

/**
 * Notices the bot sets under every panel by itself at a given time (owner,
 * 2026-11-15): each once per panel (`TimerPanel.noticeKey`), at `at` or,
 * if the bot was down then, as soon as it is back within a day. A new week's
 * notice is a new entry.
 */
export const SCHEDULED_NOTICES: readonly { key: string; at: Date; text: string }[] = [
    {
        // Monday 2026-11-16 00:01 JST, a minute after the week's results.
        key: '2026-11-16-mejiro-estate',
        at: new Date('2026-11-15T15:01:00Z'),
        text: [
            '#OnlineSensations is now up! Join Curren Chan as she ~~kidnaps~~ recruits you as her #FavoriteManager and gets on #SpecialCollabs with other umas!',
            'The Mejiros have formally extended an invitation to their esteemed Estate. Please arrive with haste.',
            '',
            '*"To offer a perfect and complete victory \u2013 that is the proof of my love."* Show up and perform with Ramonu, or be made to try again. After all, it\'s a special day at the Estate, and Ramonu accepts nothing less than perfection.',
        ].join('\n'),
    },
    {
        // Monday 2026-11-23 00:01 JST: the Fortune Tent opens (owner, 2026-11-22). Posted late if need be (24h window).
        key: '2026-11-23-fortune-tent',
        at: new Date('2026-11-22T15:01:00Z'),
        text: [
            "**Fuku-chan's Fortune Tent is open!** Find both Matikanes in **Set 1.2: Lobby Loungers 2** to unlock it, then draw one omikuji a day from **Boosts**. Blessings raise your special chance for the day; curses lower it. Shiraoki-sama decides!",
            '',
            "Weekly places now come with a boost until next week's results: 1\u20132 Abusers +5%, 3\u20135 Enjoyers +3%, 6\u201310 Regulars +1%.",
        ].join('\n'),
    },
    {
        // Owner, 2026-11-25: Ramonu's Second Love reopened (the first win was disqualified). The tent notice, plus a line.
        key: '2026-11-25-second-love-reopened',
        at: new Date('2026-11-25T16:00:00Z'),
        text: [
            "**Fuku-chan's Fortune Tent is open!** Find both Matikanes in **Set 1.2: Lobby Loungers 2** to unlock it, then draw one omikuji a day from **Boosts**. Blessings raise your special chance for the day; curses lower it. Shiraoki-sama decides!",
            '',
            "Weekly places now come with a boost until next week's results: 1\u20132 Abusers +5%, 3\u20135 Enjoyers +3%, 6\u201310 Regulars +1%.",
            '',
            "**Ramonu's Second Love is up for grabs again.** She's still waiting at the Estate.",
        ].join('\n'),
    },
];

/** How long after its time a scheduled notice may still be set (the bot was down). */
const SCHEDULED_NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Sets every scheduled notice that is due on each panel that does not have it yet. */
export async function postScheduledNotices(client: Client, now = new Date(), notices = SCHEDULED_NOTICES): Promise<number> {
    let set = 0;
    for (const n of notices) {
        if (now.getTime() < n.at.getTime() || now.getTime() > n.at.getTime() + SCHEDULED_NOTICE_WINDOW_MS) continue;
        const panels = await prisma.timerPanel.findMany({ where: { OR: [{ noticeKey: null }, { noticeKey: { not: n.key } }] } });
        for (const panel of panels) {
            const guild = client.guilds.cache.get(panel.guildId) ?? (await client.guilds.fetch(panel.guildId).catch(() => null));
            if (!guild) continue;
            const result = await setPanelNotice(client, guild, panel.channelId, n.text).catch((e) => {
                console.error(`Timer scheduled notice ${n.key} failed in ${panel.channelId}:`, e instanceof Error ? e.message : e);
                return 'failed' as const;
            });
            if (result !== 'saved') continue;
            await prisma.timerPanel.update({ where: { channelId: panel.channelId }, data: { noticeKey: n.key } });
            set += 1;
        }
    }
    return set;
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
    const notice = text?.trim() ? resolveNoticeMentions(guild, text.trim()).slice(0, NOTICE_MAX_LENGTH) : null;
    if (!notice) {
        if (panel.noticeMessageId) await channel.messages.delete(panel.noticeMessageId).catch(() => undefined);
        await prisma.timerPanel.update({ where: { channelId }, data: { notice: null, noticeMessageId: null } });
        return 'removed';
    }
    await prisma.timerPanel.update({ where: { channelId }, data: { notice } });
    if (panel.noticeMessageId) {
        try {
            const message = await channel.messages.fetch(panel.noticeMessageId);
            await message.edit(noticeBox(notice));
            return 'saved';
        } catch {
            // Deleted by hand, or an older plain-text notice that cannot become
            // a box by an edit: post the sticky again, notice included.
        }
    }
    return (await postPanelPair(client, guild, channelId)) ? 'saved' : 'failed';
}

/**
 * Turns a bare "@<id>" in a notice into a mention Discord shows as a pill
 * (owner, 2026-11-17): a role mention if the server has a role with that id,
 * else a member mention. Notices never ping, so this is only for display.
 */
export function resolveNoticeMentions(guild: { roles?: { cache?: { has(id: string): boolean } } }, text: string): string {
    const isRole = (id: string) => guild.roles?.cache?.has(id) ?? false;
    return text.replace(/(^|[^<@&\w])@(\d{17,20})\b/g, (_m, lead: string, id: string) => `${lead}${isRole(id) ? `<@&${id}>` : `<@${id}>`}`);
}

/**
 * Notices set under every panel of a server the first time one of its
 * special roles is won there (owner, 2026-11-17). `{role}` becomes the role
 * mention, `{winner}` the winner's. One entry per special role.
 */
export const ROLE_WIN_NOTICES: Record<string, string> = {
    // Added under the panel's current notice (owner, 2026-11-25), not in place of it.
    'second-love': "To Ramonu, she's always cared about the track. That's how she ended up recruiting you too. And yet, as her eyes waver for just a moment, trying to meet yours... you feel your heart swaying on the same beat. {role}",
};

/** Sets a role's win notice (`ROLE_WIN_NOTICES[key]`) under every panel of `guild`. Returns how many were set. */
export async function postRoleWinNotice(client: Client, guild: Guild, key: string, fill: { roleId: string | null; winnerId: string }): Promise<number> {
    const template = ROLE_WIN_NOTICES[key];
    if (!template) return 0;
    const text = template.replaceAll('{role}', fill.roleId ? `<@&${fill.roleId}>` : '').replaceAll('{winner}', `<@${fill.winnerId}>`).trim();
    let set = 0;
    for (const panel of await prisma.timerPanel.findMany({ where: { guildId: guild.id } })) {
        // Added under what the panel already says (owner, 2026-11-25), so the week's notice stays.
        const combined = panel.notice?.trim() ? `${panel.notice.trim()}\n\n${text}` : text;
        const result = await setPanelNotice(client, guild, panel.channelId, combined).catch((e) => {
            console.error(`Timer role-win notice ${key} failed in ${panel.channelId}:`, e instanceof Error ? e.message : e);
            return 'failed' as const;
        });
        if (result === 'saved') set += 1;
    }
    return set;
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

/**
 * People whose posts may sit under the sticky: their posts never move it,
 * so a sneak peek stays at the very bottom. The next post by anyone else
 * moves the sticky below both. Owner, 2026-11-15: just the owner.
 */
export const STICKY_EXEMPT: readonly string[] = ['688006136690900996'];

/** messageCreate: a post by anyone but the bot (or `STICKY_EXEMPT`), in a channel with a sticky, schedules a check. */
export async function onChannelMessage(message: Message): Promise<void> {
    if (!message.inGuild() || message.author.id === message.client.user.id) return;
    if (STICKY_EXEMPT.includes(message.author.id)) return;
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
        // Posts by STICKY_EXEMPT do not count: the sticky may sit above them.
        const newer = [...(await channel.messages.fetch({ after: last, limit: 50 })).entries()]
            .filter(([, m]) => !STICKY_EXEMPT.includes((m as { author?: { id?: string } }).author?.id ?? ''))
            .map(([id]) => id);
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
