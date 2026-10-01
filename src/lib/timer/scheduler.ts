import { type Client } from 'discord.js';
import {
    claimExpiredNotifications,
    claimExpiredTimers,
    getPanelContext,
    listActiveTimers,
    recordRun,
    scheduleNotificationDeletion,
    type CompletionSummary,
} from './service';
import { refreshPanel } from './panel';

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

/** Builds the message body for an expiry ping. */
function buildPingContent(discordUserId: string, summary: CompletionSummary, lagSeconds: number): string {
    const lines = [`<@${discordUserId}> Your trainer timer has reached 0.`];

    if (lagSeconds > LATE_DELIVERY_THRESHOLD_S) {
        const minutes = Math.round(lagSeconds / 60);
        lines.push(`*This run ended about ${minutes} minute${minutes === 1 ? '' : 's'} ago while the bot was offline. It still counted.*`);
    }

    const rewards: string[] = [];
    if (summary.milestone !== null) {
        rewards.push(
            summary.milestone === 1
                ? 'First run recorded. Welcome.'
                : `Run number **${summary.milestone}**.`,
        );
    }
    if (summary.newLongestStreak) {
        rewards.push(`New personal best: **${summary.currentStreakDays} day** streak.`);
    } else if (summary.firstOfDay && summary.currentStreakDays > 1) {
        rewards.push(`**${summary.currentStreakDays} day** streak.`);
    }
    if (rewards.length > 0) lines.push(rewards.join(' '));

    return lines.join('\n');
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

            const channel = await client.channels.fetch(timer.channelId);
            if (channel?.isTextBased() && 'send' in channel) {
                const message = await channel.send({
                    content: buildPingContent(timer.discordUserId, summary, lagSeconds),
                    allowedMentions: { users: [timer.discordUserId] },
                });
                await scheduleNotificationDeletion(timer.channelId, message.id);
            }

            if (timer.panelMessageId) {
                panels.set(`${timer.channelId}:${timer.panelMessageId}`, {
                    channelId: timer.channelId,
                    messageId: timer.panelMessageId,
                    guildId: timer.guildId,
                });
            }
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

    const tick = async () => {
        // Skip if the previous tick is still working. Without this a slow batch
        // could overlap itself; the atomic DELETE...RETURNING claims would stay
        // correct, but the overlap would serve no purpose.
        if (running) return;
        running = true;
        try {
            await processExpiredTimers(client);
            await processExpiredNotifications(client);
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
