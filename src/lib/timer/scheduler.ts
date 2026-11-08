import type { Client, Guild } from 'discord.js';
import {
    claimExpiredNotifications,
    claimExpiredTimers,
    getPanelContext,
    listActiveTimers,
    dayKey,
    recordRun,
    scheduleNotificationDeletion,
    type CompletionSummary,
} from './service';
import { refreshPanel } from './panel';
import { awardMilestone, getTimerSettings, runWeeklyAwards, type WeeklyAward } from './rewards';
import { weekResultsPost } from './boardImage';
import { activeBoosts, chooseOpener, grantBoost, isRareOpener, lockedSetsFor, recordRareOpener, spendBoosts, type ExtraChance } from './rares';
import { EARLY_START, SPECIAL_SETS, boostPool, fillOpener, pickOpener, rarePoolFor } from './openers';
import type { UserSettings } from './userSettings';
import { getUserSettings, pingMinutes } from './userSettings';
import { currentPanelMessageId, flushLiveBoards, keepPanelAtBottom, markAllLiveBoardsDirty, markLiveBoardsDirty } from './livePanel';

/**
 * Drives timer expiry and notification cleanup.
 *
 * Deliberately a polling loop over the database rather than a set of in-process
 * `setTimeout` handles. Timers therefore have no in-memory state to lose: a
 * restart resumes exactly where it left off, and the first tick after startup
 * fires everything that came due while the bot was down. That is the behaviour
 * the reference bot lacks, where a run ending during downtime is discarded.
 *
 * The queries are indexed on `expiresAt` / `deleteAt` and return nothing
 * almost every tick, so the polling cost is negligible.
 */

/** How often to check for due timers. */
const TICK_INTERVAL_MS = 10_000;

/**
 * A ping delayed by more than this is reported to the trainer as late, so a
 * surprising timestamp is explained rather than looking like a bug.
 */
const LATE_DELIVERY_THRESHOLD_S = 120;

/** How often to check whether a week needs awarding. */
const AWARD_CHECK_MS = 60_000;

export { PING_OPENERS, RARE_PING_OPENERS, RARE_OPENER_CHANCE, pickOpener } from './openers';

/**
 * Builds the message body for an expiry ping: an opener (a rare one 4% of
 * the time), then a bold-led line for each thing worth celebrating
 * (the run's number, a streak, a new milestone role). `milestoneRoleId` is
 * a role the run just earned; it is mentioned but, with only the user
 * allowed to be pinged, does not notify the role. `random` is injectable
 * for tests.
 */
export function buildPingContent(
    discordUserId: string,
    summary: CompletionSummary,
    lagSeconds: number,
    milestoneRoleId: string | null = null,
    random: () => number = Math.random,
    opener?: string,
): string {
    const lines = [fillOpener(opener ?? pickOpener(random()), discordUserId)];

    if (lagSeconds > LATE_DELIVERY_THRESHOLD_S) {
        const minutes = Math.round(lagSeconds / 60);
        lines.push(`*Apologies! This run ended about ${minutes} minute${minutes === 1 ? '' : 's'} ago while I was offline. It still counts!*`);
    }

    if (summary.milestone !== null) {
        lines.push(
            summary.milestone === 1
                ? '**Debut!** Your very first run is on the record! Welcome to the track!'
                : `**Milestone!** That makes run #**${summary.milestone}**!`,
        );
    }
    if (summary.newLongestStreak) {
        lines.push(`**Record!** A new personal best: **${summary.currentStreakDays} days** in a row!`);
    } else if (summary.firstOfDay && summary.currentStreakDays > 1) {
        lines.push(`**Persistence!** **${summary.currentStreakDays} days** straight! Keep it going!`);
    }
    if (milestoneRoleId) lines.push(`**Promotion!** **${summary.totalRuns} runs** reached, and <@&${milestoneRoleId}> is yours!`);

    return lines.join('\n');
}

/**
 * The extra special chances on one trainer's ping, when their Boosts are on:
 *
 *   - each set boost they hold, for a set they have on and unlocked: its
 *     chance, drawn from that set's lines with the boost's tag;
 *   - early start, when the run was one: its chance, drawn from their usual
 *     special pool.
 */
export async function extraChances(
    guildId: string,
    discordUserId: string,
    settings: UserSettings,
    lockedSets: readonly string[],
    earlyStart: boolean,
    pool: readonly string[],
): Promise<ExtraChance[]> {
    if (!settings.boosts) return [];
    const extras: ExtraChance[] = [];
    for (const held of await activeBoosts(guildId, discordUserId)) {
        if (settings.disabledSets.includes(held.setId) || lockedSets.includes(held.setId)) continue;
        const boost = SPECIAL_SETS.find((s) => s.id === held.setId)?.openers.find((o) => o.boost)?.boost;
        if (boost) extras.push({ chance: boost.chance, pool: boostPool(held.setId, boost.tag) });
    }
    if (earlyStart) extras.push({ chance: EARLY_START.chance, pool });
    return extras;
}

/** A guild the bot is in, from the cache or Discord; null when it is not. */
async function guildOf(client: Client, guildId: string): Promise<Guild | null> {
    return client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
}

/** Posts a week's final board where the guild asked for it, pinging the winners. */
async function announceAward(client: Client, award: WeeklyAward): Promise<void> {
    const settings = await getTimerSettings(award.guildId);
    if (!settings?.announceChannelId) return;
    const guild = await guildOf(client, award.guildId);
    const channel = await client.channels.fetch(settings.announceChannelId).catch(() => null);
    if (!guild || !channel?.isTextBased() || !('send' in channel)) return;
    await channel.send(await weekResultsPost(guild, award.week, true));
    // Keep the timer panel below the results when they share a channel.
    await keepPanelAtBottom(client, guild, settings.announceChannelId);
}

/** Awards any week that has ended and announces it. */
async function processWeeklyAwards(client: Client): Promise<void> {
    const awards = await runWeeklyAwards((guildId) => guildOf(client, guildId));
    for (const award of awards) {
        try {
            await announceAward(client, award);
        } catch (e) {
            console.error(`Timer weekly award post failed for guild ${award.guildId}:`, e);
        }
    }
}

/** Delivers every timer that has reached zero. */
async function processExpiredTimers(client: Client): Promise<void> {
    const now = new Date();
    const expired = await claimExpiredTimers(now);
    if (expired.length === 0) return;

    // Panels are refreshed once per panel after all pings are sent, rather than
    // once per timer, so a batch recovered after downtime does not trigger a
    // burst of near-identical edits against Discord's rate limit.
    const panels = new Map<string, { channelId: string; messageId: string; guildId: string }>();

    for (const timer of expired) {
        try {
            const lagSeconds = Math.max(0, Math.round((now.getTime() - timer.expiresAt.getTime()) / 1000));
            const summary = await recordRun(timer, now);
            // A milestone that cannot be given must not cost the trainer their ping.
            let milestoneRoleId: string | null = null;
            try {
                const guild = await guildOf(client, timer.guildId);
                if (guild) milestoneRoleId = await awardMilestone(guild, timer.discordUserId, summary.totalRuns);
            } catch (e) {
                console.error(`Timer milestone check failed for user ${timer.discordUserId}:`, e);
            }

            const channel = await client.channels.fetch(timer.channelId);
            if (channel?.isTextBased() && 'send' in channel) {
                // The opener is picked once, from the sets the trainer has on,
                // so the line posted is the one recorded.
                const settings = await getUserSettings(timer.guildId, timer.discordUserId);
                const lockedSets = await lockedSetsFor(timer.guildId, timer.discordUserId);
                const pool = rarePoolFor(settings.disabledSets, lockedSets);
                const extras = await extraChances(timer.guildId, timer.discordUserId, settings, lockedSets, timer.earlyStart, pool);
                const opener = await chooseOpener(timer.guildId, timer.discordUserId, Math.random(), pool, extras);
                const content = buildPingContent(timer.discordUserId, summary, lagSeconds, milestoneRoleId, Math.random, opener);
                const message = await channel.send({ content, allowedMentions: { users: [timer.discordUserId] } });
                await scheduleNotificationDeletion(timer.channelId, message.id, pingMinutes(settings));
                // Boosts tick down only while on (off pauses them). A boost
                // this ping grants starts after it, with its full count.
                if (settings.boosts) await spendBoosts(timer.guildId, timer.discordUserId);
                if (isRareOpener(opener)) {
                    await recordRareOpener(timer.guildId, timer.discordUserId, opener);
                    await grantBoost(timer.guildId, timer.discordUserId, opener);
                }
                if (settings.dmPing) {
                    // A copy in their DMs; it pings nobody else and is not deleted.
                    await client.users
                        .fetch(timer.discordUserId)
                        .then((user) => user.send({ content, allowedMentions: { parse: [] } }))
                        .catch((e) => console.warn(`Timer DM to ${timer.discordUserId} failed (DMs closed?):`, e instanceof Error ? e.message : e));
                }
            }

            // The channel's current panel, which may have been reposted since
            // this run started; else the panel the run was started from.
            const panelId = (await currentPanelMessageId(timer.channelId)) ?? timer.panelMessageId;
            if (panelId) {
                panels.set(`${timer.channelId}:${panelId}`, { channelId: timer.channelId, messageId: panelId, guildId: timer.guildId });
            }
            markLiveBoardsDirty(timer.guildId);
        } catch (e) {
            // One undeliverable ping must not stall the rest of the batch. The
            // run is already recorded, so the trainer keeps credit for it.
            console.error(`Timer expiry failed for user ${timer.discordUserId}:`, e);
        }
    }

    for (const panel of panels.values()) {
        const [timers, context] = await Promise.all([
            listActiveTimers(panel.guildId),
            getPanelContext(panel.guildId),
        ]);
        await refreshPanel(client, panel.channelId, panel.messageId, timers, context);
    }
}

/** Removes expiry pings that have outlived their display time. */
async function processExpiredNotifications(client: Client): Promise<void> {
    const due = await claimExpiredNotifications(new Date());

    for (const notification of due) {
        try {
            const channel = await client.channels.fetch(notification.channelId);
            if (!channel?.isTextBased()) continue;
            await channel.messages.delete(notification.messageId);
        } catch {
            // Already deleted by a moderator, or the channel is gone. The row is
            // claimed either way, so this never retries forever.
        }
    }
}

/**
 * Starts the scheduler.
 *
 * Ticks immediately on start so anything that expired during downtime is
 * delivered at once instead of waiting out a full interval.
 *
 * @returns A function that stops the loop.
 */
export function startScheduler(client: Client): () => void {
    let running = false;
    let lastAwardCheck = 0;
    // The day the live boards were last reset for; empty, so startup redraws them.
    let liveDay = '';

    const tick = async () => {
        // Skip if the previous tick is still working. Without this a slow batch
        // could overlap itself; the atomic DELETE...RETURNING claims would stay
        // correct, but the overlap would serve no purpose.
        if (running) return;
        running = true;
        try {
            await processExpiredTimers(client);
            await processExpiredNotifications(client);
            if (Date.now() - lastAwardCheck >= AWARD_CHECK_MS) {
                lastAwardCheck = Date.now();
                await processWeeklyAwards(client);
            }
            // A new day: every live board's "today" starts over.
            const today = dayKey(new Date());
            if (today !== liveDay) {
                liveDay = today;
                await markAllLiveBoardsDirty();
            }
            await flushLiveBoards(client);
        } catch (e) {
            console.error('Timer scheduler tick failed:', e);
        } finally {
            running = false;
        }
    };

    void tick();
    const handle = setInterval(() => void tick(), TICK_INTERVAL_MS);
    return () => clearInterval(handle);
}
