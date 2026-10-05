import { AttachmentBuilder, type Client } from 'discord.js';
import { refreshCutoffs, refreshCutoffsIfStale } from './cutoff';
import type { TrackedCircle } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { isConfigured } from '../umamoe/client';
import { TRACKED, backfillOnce, currentGameMonth, syncAllCircles, syncBenchmark } from './ingest';
import { currentCircleProgress, formatReportDate } from './reports';
import { renderFanReport } from '../image/renderFanReport';
import { formatCompactFans, formatFans, describeQuota } from './metrics';

/**
 * Fan sync and report posting, as two jobs:
 *
 *   hourly  pulls every active circle (and the benchmark) from uma.moe, so the
 *           dashboard and commands stay current. uma.moe now refreshes live
 *           figures hourly for most circles (every 5 minutes for the top 100).
 *   daily   syncs once more and posts each circle's report and alerts, once a
 *           day at FAN_SYNC_HOUR_UTC, so channels are not spammed hourly.
 *
 * Idempotence matters more than precision here: the container can restart at
 * any moment, so the job records its last run in the database and checks that
 * marker before doing anything. A restart at 12:05 does not re-post the report
 * that already went out at 12:00.
 */

const JOB_NAME = 'daily-fan-sync';
const HOURLY_JOB_NAME = 'hourly-fan-sync';

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

/** `YYYY-MM-DDTHH` in UTC, the unit the hourly job is scheduled in. */
function utcHourKey(date: Date): string {
    return date.toISOString().slice(0, 13);
}

/** True when the hourly job has not yet run in the current UTC hour. */
async function isHourlyDue(now: Date): Promise<boolean> {
    const record = await prisma.jobRun.findUnique({ where: { id: HOURLY_JOB_NAME } });
    return !record || utcHourKey(record.lastRunAt) !== utcHourKey(now);
}

/** True when the daily job has not yet run for the current UTC day. */
async function isDue(now: Date): Promise<boolean> {
    if (now.getUTCHours() < SYNC_HOUR_UTC) return false;

    const record = await prisma.jobRun.findUnique({ where: { id: JOB_NAME } });
    if (!record) return true;
    return utcDayKey(record.lastRunAt) !== utcDayKey(now);
}

/** A rendered report and its behind-quota alert, ready to send anywhere. */
export interface CircleReport {
    image: AttachmentBuilder;
    /** Null when nobody is behind. */
    alert: { content: string; users: string[] } | null;
    behindCount: number;
}

/**
 * Renders a circle's report image and builds its alert. Alerts name the
 * trainers who are behind, and tag them where a Discord link exists, so the
 * message is actionable rather than just informative.
 *
 * In checkpoint periods (daily, weekly, biweekly) nobody is behind until a
 * checkpoint passes, and `scheduled` reports leave the alert out unless one
 * has just closed, so a missed week is announced once, the day after it
 * ends, not every day of the next week. A manual check always includes it.
 *
 * @returns Null when nothing has been ingested for the current month.
 */
export async function buildCircleReport(circle: TrackedCircle, { scheduled = false }: { scheduled?: boolean } = {}): Promise<CircleReport | null> {
    const progress = await currentCircleProgress(circle);
    if (!progress) return null;

    const { year, month } = currentGameMonth();
    const buffer = await renderFanReport(progress, {
        circleName: circle.name,
        monthlyRank: circle.monthlyRank,
        memberCount: progress.members.length,
        dateLabel: formatReportDate(year, month, progress.daysElapsed),
    });
    const image = new AttachmentBuilder(buffer, { name: `fan-report-${circle.circleId}.png` });

    const allBehind = progress.members.filter((m) => !m.onPace);
    const behind = allBehind.slice(0, ALERT_LIMIT);
    if (behind.length === 0) return { image, alert: null, behindCount: 0 };
    if (scheduled && !progress.checkpointJustClosed) return { image, alert: null, behindCount: allBehind.length };

    const links = await prisma.trainerLink.findMany({
        where: { guildId: circle.guildId, viewerId: { in: behind.map((m) => BigInt(m.viewerId)) } },
    });
    const mentionByViewer = new Map(links.map((l) => [l.viewerId.toString(), l.discordUserId]));

    const lines = behind.map((m) => {
        const mention = mentionByViewer.get(String(m.viewerId));
        const who = mention ? `<@${mention}>` : m.trainerName;
        return `${who} — behind by **${formatFans(m.behind)}**, needs **${formatFans(m.needPerDay ?? 0)}**/day`;
    });

    return {
        image,
        behindCount: allBehind.length,
        alert: {
            content:
                `**${circle.name}** — ${allBehind.length} trainer${allBehind.length === 1 ? '' : 's'} behind quota ` +
                `(${describeQuota(progress.quota, progress.period)} · ` +
                `${progress.period === 'MONTH' ? progress.windowLabel : `checked at end of day ${progress.checkpointDay}`})\n` +
                lines.join('\n'),
            users: [...mentionByViewer.values()],
        },
    };
}

/** Sends a message to a channel or thread by ID; false when it cannot be posted to. */
async function sendTo(client: Client, channelId: string, message: Parameters<SendableChannel['send']>[0]): Promise<boolean> {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !('send' in channel)) return false;
    await channel.send(message);
    return true;
}

type SendableChannel = Extract<NonNullable<Awaited<ReturnType<Client['channels']['fetch']>>>, { send: unknown }>;

/**
 * Sends a circle's report image to its configured report channel, and the
 * alert to its alert channel when anyone is behind. Used by the daily job and
 * by `/fans all` and `/fans club`.
 *
 * @returns What was posted, or null when the circle has no report channel or
 *          no data this month.
 */
export async function postReport(
    client: Client,
    circleId: string,
    /** True for the daily job; see `buildCircleReport`. */
    { scheduled = false }: { scheduled?: boolean } = {},
): Promise<{ behindCount: number; alerted: boolean } | null> {
    const circle = await prisma.trackedCircle.findUnique({ where: { id: circleId } });
    if (!circle?.reportChannelId) return null;

    const report = await buildCircleReport(circle, { scheduled });
    if (!report) return null;

    if (!(await sendTo(client, circle.reportChannelId, { files: [report.image] }))) return null;

    let alerted = false;
    if (circle.alertChannelId && report.alert) {
        alerted = await sendTo(client, circle.alertChannelId, {
            content: report.alert.content,
            allowedMentions: { users: report.alert.users },
        });
    }
    return { behindCount: report.behindCount, alerted };
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
    const cutoffNote = await refreshCutoffs()
        .then((r) => ` cutoffs:${r.done.length}${r.failed.length > 0 ? ` (${r.failed.join('; ')})` : ''}`)
        .catch((e: unknown) => ` cutoffs failed: ${e instanceof Error ? e.message : String(e)}`);

    const circles = await prisma.trackedCircle.findMany({ where: { active: true, ...TRACKED } });
    for (const circle of circles) {
        try {
            await postReport(client, circle.id, { scheduled: true });
        } catch (e) {
            // A channel the bot can no longer post to must not abort the run.
            console.error(`Failed to post fan report for ${circle.name}:`, e);
        }
    }

    return `synced:${results.length} errors:${errors.length}${benchmarkNote}${cutoffNote}`;
}

/**
 * Refreshes every active circle and the benchmark without posting anything.
 * Like the daily job, the marker is written first so a crash cannot loop.
 */
async function runHourlySync(now: Date): Promise<void> {
    await prisma.jobRun.upsert({
        where: { id: HOURLY_JOB_NAME },
        create: { id: HOURLY_JOB_NAME, lastRunAt: now, note: 'started' },
        update: { lastRunAt: now, note: 'started' },
    });
    const { results, errors } = await syncAllCircles();
    let benchmark = 'ok';
    await syncBenchmark().catch((e: unknown) => {
        benchmark = e instanceof Error ? e.message : String(e);
    });
    // The figures change once a game day; ~60 uma.moe requests, so not every hour.
    let cutoff = 'fresh';
    await refreshCutoffsIfStale()
        .then((r) => {
            if (r) cutoff = r.failed.length > 0 ? r.failed.join('; ') : 'ok';
        })
        .catch((e: unknown) => {
            cutoff = e instanceof Error ? e.message : String(e);
        });
    const note = `synced:${results.length} errors:${errors.length} benchmark:${benchmark} cutoffs:${cutoff}`;
    await prisma.jobRun.update({ where: { id: HOURLY_JOB_NAME }, data: { note } });
    if (errors.length > 0) console.warn(`Hourly fan sync errors: ${errors.join('; ')}`);

    // One-time history import for any circle that has not had one, including
    // circles added before backfill existed. A no-op once each has run.
    for (const circle of await prisma.trackedCircle.findMany({ where: { active: true, ...TRACKED } })) {
        await backfillOnce(circle);
    }
}

/**
 * Starts the fan jobs: hourly data sync, daily reports.
 *
 * @returns A function that stops the loop.
 */
export function startFanScheduler(client: Client): () => void {
    if (!isConfigured()) {
        console.log('Fan sync disabled: EXTERNAL_API_KEY is not set.');
        return () => undefined;
    }

    let running = false;
    // The rank cutoff figures live in memory, so work them out now rather
    // than at the next hourly run; /club edit shows nothing until they exist.
    void refreshCutoffs()
        .then((r) => r.failed.length > 0 && console.warn(`Rank cutoff figures failed: ${r.failed.join('; ')}`))
        .catch((e: unknown) => console.warn('Rank cutoff figures failed:', e instanceof Error ? e.message : e));

    const check = async () => {
        if (running) return;
        running = true;
        try {
            const now = new Date();
            if (!(await isDue(now))) {
                // Not report time: just keep the data fresh, once an hour.
                if (await isHourlyDue(now)) await runHourlySync(now);
                return;
            }

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
