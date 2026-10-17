import { AttachmentBuilder, type Client } from 'discord.js';
import { refreshCutoffs, refreshCutoffsIfStale } from './cutoff';
import type { TrackedCircle } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { isConfigured } from '../umamoe/client';
import { TRACKED, backfillOnce, currentGameMonth, loadCircleProgress, syncAllCircles, syncBenchmark, syncCircle } from './ingest';
import { isAtGameReset, isReportDue, reportTimeOf } from './reportTime';
import { lastDayGains } from './readings';
import { currentCircleProgress, formatReportDate } from './reports';
import { renderFanReport } from '../image/renderFanReport';
import { formatCompactFans, formatFans, describeQuota } from './metrics';

/**
 * Fan sync and report posting:
 *
 *   hourly   pulls every active circle (and the benchmark) from uma.moe, so the
 *            dashboard and commands stay current. uma.moe now refreshes live
 *            figures hourly for most circles (every 5 minutes for the top 100).
 *   daily    syncs everything once more and refreshes the benchmark and rank
 *            cutoffs, at FAN_SYNC_HOUR_UTC.
 *   reports  each circle's report and alert, once a day at the time its staff
 *            set with `/club reports` (the daily reset, 00:00 JST, when
 *            unset). The circle is synced first unless its data is fresh.
 *
 * Idempotence matters more than precision here: the container can restart at
 * any moment, so each job records its last run in the database and checks that
 * marker before doing anything. A restart at 12:05 does not re-post the report
 * that already went out at 12:00.
 */

const JOB_NAME = 'daily-fan-sync';
const HOURLY_JOB_NAME = 'hourly-fan-sync';

/**
 * UTC hour the daily job runs at. Defaults to 13:00, an hour after the 12:00
 * GMT refresh observed in uma.moe's own `last_updated` timestamps, which
 * leaves headroom for a late publish.
 */
const SYNC_HOUR_UTC = Number(process.env.FAN_SYNC_HOUR_UTC ?? 13);

/** Data synced this recently is reported as is, without another fetch. */
const FRESH_SYNC_MS = 10 * 60_000;

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
 * In checkpoint periods (daily, weekly, biweekly) `scheduled` reports leave
 * the alert out unless a checkpoint has just closed, so a missed week is
 * announced once, the day after it ends, not every day of the next week. A
 * manual check always includes it.
 *
 * @returns Null when nothing has been ingested for the current month.
 */
export async function buildCircleReport(circle: TrackedCircle, { scheduled = false }: { scheduled?: boolean } = {}): Promise<CircleReport | null> {
    // A scheduled report at the daily reset covers the game day that just
    // ended, complete. On the 2nd JST that day was the old month's last, so
    // the report is that month's final standings, not the new month's empty
    // first day. Any other report shows the last 24 hours.
    const atReset = scheduled && isAtGameReset(reportTimeOf(circle));
    const game = currentGameMonth();
    const previous = game.month === 1 ? { year: game.year - 1, month: 12 } : { year: game.year, month: game.month - 1 };
    const { year, month } = atReset && game.day === 1 ? previous : game;
    const progress = year === game.year && month === game.month ? await currentCircleProgress(circle) : await loadCircleProgress(circle, year, month);
    if (!progress) return null;

    const buffer = await renderFanReport(progress, {
        circleName: circle.name,
        monthlyRank: circle.monthlyRank,
        memberCount: progress.members.length,
        dateLabel: formatReportDate(year, month, atReset ? progress.finishedDay : progress.daysElapsed),
        last24h: atReset ? null : await lastDayGains(circle.id),
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

/** Syncs every circle and refreshes the benchmark and rank cutoffs. Reports are posted separately. */
export async function runDailySync(): Promise<string> {
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

    return `synced:${results.length} errors:${errors.length}${benchmarkNote}${cutoffNote}`;
}

/**
 * Posts every report that is due: each active circle with a report channel,
 * once per local day at or after its report time. The marker is written
 * before the work, so a crash midway cannot re-post. Returns how many posted.
 */
export async function postDueReports(client: Client, now: Date): Promise<number> {
    const circles = await prisma.trackedCircle.findMany({ where: { active: true, reportChannelId: { not: null }, ...TRACKED } });
    let posted = 0;
    for (const circle of circles) {
        if (!isReportDue(reportTimeOf(circle), now, circle.lastReportAt)) continue;
        await prisma.trackedCircle.update({ where: { id: circle.id }, data: { lastReportAt: now } });
        try {
            if (!circle.lastSyncedAt || now.getTime() - circle.lastSyncedAt.getTime() > FRESH_SYNC_MS) {
                await syncCircle(circle).catch((e: unknown) =>
                    console.warn(`Sync before ${circle.name}'s report failed; posting the last data:`, e instanceof Error ? e.message : e),
                );
            }
            if (await postReport(client, circle.id, { scheduled: true })) posted += 1;
        } catch (e) {
            // A channel the bot can no longer post to must not stop the others.
            console.error(`Failed to post fan report for ${circle.name}:`, e);
        }
    }
    return posted;
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

/** The daily job, behind its once-a-day marker. */
async function runDaily(now: Date): Promise<void> {
    // The marker is written before the work, not after. A crash midway
    // through must not cause a retry loop; the next day's run picks things
    // up, and snapshots are upserts anyway.
    await prisma.jobRun.upsert({
        where: { id: JOB_NAME },
        create: { id: JOB_NAME, lastRunAt: now, note: 'started' },
        update: { lastRunAt: now, note: 'started' },
    });

    console.log('Running daily fan sync...');
    const note = await runDailySync();
    await prisma.jobRun.update({ where: { id: JOB_NAME }, data: { note } });
    console.log(`Daily fan sync finished: ${note}`);
}

/**
 * Starts the fan jobs: hourly data sync, the daily sync, and each circle's report.
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
    // than at the next hourly run; /club reports shows nothing until they exist.
    void refreshCutoffs()
        .then((r) => r.failed.length > 0 && console.warn(`Rank cutoff figures failed: ${r.failed.join('; ')}`))
        .catch((e: unknown) => console.warn('Rank cutoff figures failed:', e instanceof Error ? e.message : e));

    const check = async () => {
        if (running) return;
        running = true;
        try {
            const now = new Date();
            if (await isDue(now)) await runDaily(now);
            else if (await isHourlyDue(now)) await runHourlySync(now);
        } catch (e) {
            console.error('Fan sync failed:', e);
        }
        try {
            const posted = await postDueReports(client, new Date());
            if (posted > 0) console.log(`Posted ${posted} scheduled fan report(s).`);
        } catch (e) {
            console.error('Scheduled fan reports failed:', e);
        } finally {
            running = false;
        }
    };

    void check();
    const handle = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => clearInterval(handle);
}
