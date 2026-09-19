import { AttachmentBuilder, type Client } from 'discord.js';
import { prisma } from '../../db/prisma';
import { isConfigured } from '../umamoe/client';
import { currentGameMonth, syncAllCircles, syncBenchmark } from './ingest';
import { currentCircleProgress, formatReportDate } from './reports';
import { renderFanReport } from '../image/renderFanReport';
import { formatCompactFans, formatFans } from './metrics';

/**
 * Daily fan sync and report posting.
 *
 * uma.moe refreshes circle data once a day. The job therefore runs once a day,
 * shortly after that refresh, rather than polling continuously.
 *
 * Idempotence matters more than precision here: the container can restart at
 * any moment, so the job records its last run in the database and checks that
 * marker before doing anything. A restart at 12:05 does not re-post the report
 * that already went out at 12:00.
 */

const JOB_NAME = 'daily-fan-sync';

/**
 * UTC hour to run at. Defaults to 13:00, an hour after the 12:00 GMT refresh
 * observed in uma.moe's own `last_updated` timestamps, which leaves headroom
 * for a late publish.
 */
const SYNC_HOUR_UTC = Number(process.env.FAN_SYNC_HOUR_UTC ?? 13);

/** How often to check whether the daily run is due. */
const CHECK_INTERVAL_MS = 5 * 60_000;

/** Members more than this far behind are named in the alert. */
const ALERT_LIMIT = 10;

/** `YYYY-MM-DD` in UTC, the unit the daily job is scheduled in. */
function utcDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** True when the daily job has not yet run for the current UTC day. */
async function isDue(now: Date): Promise<boolean> {
    if (now.getUTCHours() < SYNC_HOUR_UTC) return false;

    const record = await prisma.jobRun.findUnique({ where: { id: JOB_NAME } });
    if (!record) return true;
    return utcDayKey(record.lastRunAt) !== utcDayKey(now);
}

/** Sends a circle's report image to its configured channel, which may be a thread. */
async function postReport(client: Client, circleId: string): Promise<void> {
    const circle = await prisma.trackedCircle.findUnique({ where: { id: circleId } });
    if (!circle?.reportChannelId) return;

    const progress = await currentCircleProgress(circle);
    if (!progress) return;

    const { year, month } = currentGameMonth();
    const buffer = await renderFanReport(progress, {
        circleName: circle.name,
        monthlyRank: circle.monthlyRank,
        memberCount: progress.members.length,
        dateLabel: formatReportDate(year, month, progress.daysElapsed),
    });

    const channel = await client.channels.fetch(circle.reportChannelId);
    if (!channel?.isTextBased() || !('send' in channel)) return;

    await channel.send({
        files: [new AttachmentBuilder(buffer, { name: `fan-report-${circle.circleId}.png` })],
    });

    if (!circle.alertChannelId) return;

    // Alerts name the trainers who are behind, and tag them where a Discord
    // link exists, so the message is actionable rather than just informative.
    const behind = progress.members.filter((m) => !m.onPace).slice(0, ALERT_LIMIT);
    if (behind.length === 0) return;

    const links = await prisma.trainerLink.findMany({
        where: { guildId: circle.guildId, viewerId: { in: behind.map((m) => BigInt(m.viewerId)) } },
    });
    const mentionByViewer = new Map(links.map((l) => [l.viewerId.toString(), l.discordUserId]));

    const lines = behind.map((m) => {
        const mention = mentionByViewer.get(String(m.viewerId));
        const who = mention ? `<@${mention}>` : m.trainerName;
        return `${who} — behind by **${formatFans(m.behind)}**, needs **${formatFans(m.needPerDay ?? 0)}**/day`;
    });

    const alertChannel = await client.channels.fetch(circle.alertChannelId);
    if (!alertChannel?.isTextBased() || !('send' in alertChannel)) return;

    await alertChannel.send({
        content:
            `**${circle.name}** — ${behind.length} trainer${behind.length === 1 ? '' : 's'} behind quota ` +
            `(${formatCompactFans(progress.effectiveQuota)}/month, day ${progress.daysElapsed}/${progress.daysInMonth})\n` +
            lines.join('\n'),
        allowedMentions: { users: [...mentionByViewer.values()] },
    });
}

/** Runs the sync and posts reports. Exported so `/fans circle sync` can reuse it. */
export async function runDailySync(client: Client): Promise<string> {
    const { results, errors } = await syncAllCircles();

    let benchmarkNote = '';
    try {
        const tiers = await syncBenchmark();
        benchmarkNote = ` benchmark:${tiers.length}`;
    } catch (e) {
        benchmarkNote = ` benchmark failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    const circles = await prisma.trackedCircle.findMany({ where: { active: true } });
    for (const circle of circles) {
        try {
            await postReport(client, circle.id);
        } catch (e) {
            // A channel the bot can no longer post to must not abort the run.
            console.error(`Failed to post fan report for ${circle.name}:`, e);
        }
    }

    return `synced:${results.length} errors:${errors.length}${benchmarkNote}`;
}

/**
 * Starts the daily job.
 *
 * @returns A function that stops the loop.
 */
export function startFanScheduler(client: Client): () => void {
    if (!isConfigured()) {
        console.log('Fan sync disabled: EXTERNAL_API_KEY is not set.');
        return () => undefined;
    }

    let running = false;

    const check = async () => {
        if (running) return;
        running = true;
        try {
            const now = new Date();
            if (!(await isDue(now))) return;

            // The marker is written before the work, not after. A crash midway
            // through must not cause a retry loop that re-posts reports; the
            // next day's run picks things up, and snapshots are upserts anyway.
            await prisma.jobRun.upsert({
                where: { id: JOB_NAME },
                create: { id: JOB_NAME, lastRunAt: now, note: 'started' },
                update: { lastRunAt: now, note: 'started' },
            });

            console.log('Running daily fan sync...');
            const note = await runDailySync(client);
            await prisma.jobRun.update({ where: { id: JOB_NAME }, data: { note } });
            console.log(`Daily fan sync finished: ${note}`);
        } catch (e) {
            console.error('Daily fan sync failed:', e);
        } finally {
            running = false;
        }
    };

    void check();
    const handle = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => clearInterval(handle);
}
