import type { TrackedCircle } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { getCircle, getTopCircles, isConfigured } from '../umamoe/client';
import {
    computeCircleProgress,
    daysInCalendarMonth,
    toSafeNumber,
    type CircleProgress,
    type MemberSeries,
} from './metrics';

/**
 * Pulls circle fan data from uma.moe into Postgres.
 *
 * Snapshots are stored one row per member per day, mirroring the API's
 * `daily_fans` array. That shape makes the sync idempotent: re-running it for a
 * day overwrites that day rather than appending a duplicate, so the job can run
 * as often as needed and can safely retry after a failure.
 */

/** Cutoffs tracked for the benchmark chart. */
export const BENCHMARK_TIERS = [10, 30, 100] as const;

/** The game month advances at 02:00 JST; day bucketing follows the same clock. */
const GAME_TIMEZONE = 'Asia/Tokyo';

/** Outcome of syncing one circle. */
export interface SyncResult {
    circleId: number;
    name: string;
    membersSeen: number;
    daysWritten: number;
}

/** Current game year and month, in the game's timezone. */
export function currentGameMonth(now = new Date()): { year: number; month: number; day: number } {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: GAME_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);

    const [year, month, day] = parts.split('-').map(Number);
    return { year: year!, month: month!, day: day! };
}

/**
 * Fetches one circle and writes its members' daily totals.
 *
 * Only days with a non-zero total are written. A zero means the day has not
 * happened yet, or the member was not in the circle, and storing those would
 * make an absent member indistinguishable from one who earned nothing.
 */
export async function syncCircle(circle: TrackedCircle, month?: number, year?: number): Promise<SyncResult> {
    const response = await getCircle(toSafeNumber(circle.circleId), month, year);

    let daysWritten = 0;

    for (const member of response.members) {
        const rows = member.daily_fans
            .map((cumulativeFans, index) => ({ day: index + 1, cumulativeFans }))
            .filter((row) => row.cumulativeFans > 0);

        for (const row of rows) {
            await prisma.fanSnapshot.upsert({
                where: {
                    trackedCircleId_viewerId_year_month_day: {
                        trackedCircleId: circle.id,
                        viewerId: BigInt(member.viewer_id),
                        year: member.year,
                        month: member.month,
                        day: row.day,
                    },
                },
                create: {
                    trackedCircleId: circle.id,
                    viewerId: BigInt(member.viewer_id),
                    trainerName: member.trainer_name,
                    year: member.year,
                    month: member.month,
                    day: row.day,
                    cumulativeFans: BigInt(row.cumulativeFans),
                    shameScore: member.shame_score,
                },
                update: {
                    trainerName: member.trainer_name,
                    cumulativeFans: BigInt(row.cumulativeFans),
                    shameScore: member.shame_score,
                },
            });
            daysWritten += 1;
        }
    }

    await prisma.trackedCircle.update({
        where: { id: circle.id },
        data: { name: response.circle.name, monthlyRank: response.circle.monthly_rank, lastSyncedAt: new Date() },
    });

    return {
        circleId: toSafeNumber(circle.circleId),
        name: response.circle.name,
        membersSeen: response.members.length,
        daysWritten,
    };
}

/** Syncs every active tracked circle. Individual failures do not stop the run. */
export async function syncAllCircles(): Promise<{ results: SyncResult[]; errors: string[] }> {
    const circles = await prisma.trackedCircle.findMany({ where: { active: true } });
    const results: SyncResult[] = [];
    const errors: string[] = [];

    for (const circle of circles) {
        try {
            results.push(await syncCircle(circle));
        } catch (e) {
            errors.push(`${circle.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return { results, errors };
}

/**
 * Records today's fans-per-member-per-day at each benchmark cutoff.
 *
 * uma.moe publishes only current circle totals, never their history, so this
 * chart is built from snapshots the bot accumulates. History therefore begins
 * at the first successful sync rather than at the start of the month.
 */
export async function syncBenchmark(): Promise<{ tier: number; entry: number; average: number }[]> {
    const { year, month, day } = currentGameMonth();
    const deepest = Math.max(...BENCHMARK_TIERS);
    const circles = await getTopCircles(deepest);

    // Fans per member per day. Circles with no members or no points cannot
    // contribute a meaningful rate and are dropped rather than counted as zero.
    const rates = circles
        .map((c) => {
            const points = c.monthly_point ?? 0;
            const members = c.member_count ?? 0;
            if (points <= 0 || members <= 0) return null;
            return Math.floor(points / members / day);
        })
        .filter((rate): rate is number => rate !== null);

    const written: { tier: number; entry: number; average: number }[] = [];

    for (const tier of BENCHMARK_TIERS) {
        if (rates.length < tier) continue;

        const slice = rates.slice(0, tier);
        // "Entry" is the value on the cutoff itself: what it takes to be tier-th.
        const entry = slice[tier - 1]!;
        const average = Math.floor(slice.reduce((sum, r) => sum + r, 0) / tier);

        await prisma.benchmarkSnapshot.upsert({
            where: { year_month_day_tier: { year, month, day, tier } },
            create: { year, month, day, tier, entryValue: BigInt(entry), avgValue: BigInt(average) },
            update: { entryValue: BigInt(entry), avgValue: BigInt(average) },
        });

        written.push({ tier, entry, average });
    }

    return written;
}

/**
 * Rebuilds a circle's progress from stored snapshots.
 *
 * Reads from the database rather than calling the API, so reports stay fast and
 * keep working during a uma.moe outage. Returns null when nothing has been
 * ingested for that month yet.
 */
export async function loadCircleProgress(
    circle: TrackedCircle,
    year: number,
    month: number,
    quotaDaysOffset = 0,
): Promise<CircleProgress | null> {
    const snapshots = await prisma.fanSnapshot.findMany({
        where: { trackedCircleId: circle.id, year, month },
        orderBy: [{ viewerId: 'asc' }, { day: 'asc' }],
    });

    if (snapshots.length === 0) return null;

    const byViewer = new Map<string, MemberSeries>();

    for (const snapshot of snapshots) {
        const key = snapshot.viewerId.toString();
        let series = byViewer.get(key);
        if (!series) {
            series = {
                viewerId: toSafeNumber(snapshot.viewerId),
                trainerName: snapshot.trainerName ?? key,
                dailyFans: new Array<number>(31).fill(0),
                shameScore: snapshot.shameScore,
            };
            byViewer.set(key, series);
        }
        series.dailyFans[snapshot.day - 1] = toSafeNumber(snapshot.cumulativeFans);
        // The latest row wins for name and shame score.
        if (snapshot.trainerName) series.trainerName = snapshot.trainerName;
        if (snapshot.shameScore !== null) series.shameScore = snapshot.shameScore;
    }

    return computeCircleProgress([...byViewer.values()], {
        monthlyQuota: toSafeNumber(circle.monthlyQuota),
        daysInMonth: daysInCalendarMonth(year, month),
        quotaDaysOffset,
    });
}

/** Benchmark history for the chart, oldest first. */
export async function loadBenchmarkHistory(days = 14): Promise<
    { day: number; month: number; tiers: Record<number, { entry: number; average: number }> }[]
> {
    const rows = await prisma.benchmarkSnapshot.findMany({
        orderBy: [{ year: 'asc' }, { month: 'asc' }, { day: 'asc' }],
        take: days * BENCHMARK_TIERS.length,
    });

    const byDate = new Map<string, { day: number; month: number; tiers: Record<number, { entry: number; average: number }> }>();

    for (const row of rows) {
        const key = `${row.year}-${row.month}-${row.day}`;
        let entry = byDate.get(key);
        if (!entry) {
            entry = { day: row.day, month: row.month, tiers: {} };
            byDate.set(key, entry);
        }
        entry.tiers[row.tier] = {
            entry: toSafeNumber(row.entryValue),
            average: toSafeNumber(row.avgValue),
        };
    }

    return [...byDate.values()].slice(-days);
}

/** True when a uma.moe key is present, so callers can explain the gap. */
export const hasApiKey = isConfigured;
