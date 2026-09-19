import type { TrackedCircle } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { BENCHMARK_TIERS, currentGameMonth, loadBenchmarkHistory, loadCircleProgress } from './ingest';
import { daysInCalendarMonth, toSafeNumber, type CircleProgress } from './metrics';
import type { TrainerReportData } from '../image/renderTrainerReport';
import type { BenchmarkData } from '../image/renderBenchmark';

/**
 * Assembles the data each rendered report needs from stored snapshots.
 *
 * Kept separate from both the renderers and the ingest job so the same figures
 * can be served to Discord and to the dashboard without duplicating the
 * derivation.
 */

/** Default number of days plotted on a trainer report. */
export const TRAINER_WINDOW_DAYS = 14;

/** Circle progress for the current game month, or null if nothing is ingested. */
export async function currentCircleProgress(circle: TrackedCircle): Promise<CircleProgress | null> {
    const { year, month } = currentGameMonth();
    return loadCircleProgress(circle, year, month);
}

/** Formats a game month as a report heading, e.g. "September 14, 2026". */
export function formatReportDate(year: number, month: number, day: number): string {
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

/**
 * Builds a trainer's report for the last `windowDays` days.
 *
 * Gains are differences between consecutive cumulative totals. The day before
 * the window is read as well, so the first plotted day shows a true gain rather
 * than the whole month-to-date total.
 */
export async function buildTrainerReport(
    circle: TrackedCircle,
    viewerId: bigint,
    windowDays = TRAINER_WINDOW_DAYS,
    /** Circle progress, when the caller has it; supplies rank and percentile. */
    progress: CircleProgress | null = null,
): Promise<TrainerReportData | null> {
    const { year, month } = currentGameMonth();

    const snapshots = await prisma.fanSnapshot.findMany({
        where: { trackedCircleId: circle.id, viewerId, year, month },
        orderBy: { day: 'asc' },
    });

    if (snapshots.length === 0) return null;

    const cumulative = new Array<number>(32).fill(0);
    let trainerName = viewerId.toString();
    let shameScore: number | null = null;
    let lastUpdated: Date | null = null;
    let lastDay = 0;

    for (const snapshot of snapshots) {
        cumulative[snapshot.day] = toSafeNumber(snapshot.cumulativeFans);
        if (snapshot.trainerName) trainerName = snapshot.trainerName;
        if (snapshot.shameScore !== null) shameScore = snapshot.shameScore;
        lastUpdated = snapshot.recordedAt;
        lastDay = Math.max(lastDay, snapshot.day);
    }

    // Carry totals forward across days with no row, so a missed sync reads as
    // a zero-gain day rather than a drop to zero and a spike afterwards.
    for (let day = 1; day <= lastDay; day += 1) {
        if (cumulative[day] === 0) cumulative[day] = cumulative[day - 1] ?? 0;
    }

    const firstDay = Math.max(1, lastDay - windowDays + 1);
    const dailyGains: { label: string; gain: number }[] = [];
    for (let day = firstDay; day <= lastDay; day += 1) {
        dailyGains.push({
            label: `Day ${day}`,
            gain: Math.max(0, (cumulative[day] ?? 0) - (cumulative[day - 1] ?? 0)),
        });
    }

    const windowFans = dailyGains.reduce((sum, d) => sum + d.gain, 0);
    const daysInMonth = daysInCalendarMonth(year, month);
    const quotaPerDay = Math.floor(toSafeNumber(circle.monthlyQuota) / daysInMonth);

    // Whole-month figures, independent of the plotted window.
    let bestDay: { label: string; gain: number } | null = null;
    let aboveQuotaStreak = 0;
    let streakOpen = true;
    for (let day = lastDay; day >= 1; day -= 1) {
        const gain = Math.max(0, (cumulative[day] ?? 0) - (cumulative[day - 1] ?? 0));
        if (bestDay === null || gain > bestDay.gain) bestDay = { label: `Day ${day}`, gain };
        // Counted from the latest day backwards; the first miss ends it.
        if (streakOpen && gain >= quotaPerDay && quotaPerDay > 0) aboveQuotaStreak += 1;
        else streakOpen = false;
    }

    const member = progress?.members.find((m) => m.viewerId === toSafeNumber(viewerId)) ?? null;

    return {
        rankInCircle: member?.rank ?? null,
        circleSize: progress?.members.length ?? null,
        bestDay,
        aboveQuotaStreak,
        quotaPerDay,
        trainerName,
        circleName: circle.name,
        dailyGains,
        windowFans,
        dailyAverage: dailyGains.length === 0 ? 0 : Math.floor(windowFans / dailyGains.length),
        // The goal is the quota owed across exactly the days plotted, so the
        // percentage answers "am I on pace over this window".
        goal: quotaPerDay * dailyGains.length,
        shameScore,
        windowLabel: `Last ${dailyGains.length} day${dailyGains.length === 1 ? '' : 's'}`,
        lastUpdated,
    };
}

/**
 * The club's own fans-per-member-per-day by game day, for overlaying on the
 * benchmark. Member count is taken per day, so a mid-month join or leave does
 * not distort the rate for the days before it.
 */
async function clubRateByDay(circle: TrackedCircle): Promise<Record<number, number>> {
    const { year, month } = currentGameMonth();
    const rows = await prisma.fanSnapshot.groupBy({
        by: ['day'],
        where: { trackedCircleId: circle.id, year, month },
        _sum: { cumulativeFans: true },
        _count: { viewerId: true },
    });

    const rateByDay: Record<number, number> = {};
    for (const row of rows) {
        const sum = row._sum.cumulativeFans;
        const count = row._count.viewerId;
        if (sum === null || count === 0 || row.day === 0) continue;
        rateByDay[row.day] = Math.floor(toSafeNumber(sum) / count / row.day);
    }
    return rateByDay;
}

/**
 * Builds the benchmark view from the newest snapshot plus accumulated history.
 *
 * With a circle supplied, the club's own rate is overlaid so the chart answers
 * "where are we" rather than only "what does it take".
 */
export async function buildBenchmark(
    windowDays = TRAINER_WINDOW_DAYS,
    circle: TrackedCircle | null = null,
): Promise<BenchmarkData> {
    const history = await loadBenchmarkHistory(windowDays);
    const club = circle ? { name: circle.name, rateByDay: await clubRateByDay(circle) } : null;

    const latest = await prisma.benchmarkSnapshot.findMany({
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { day: 'desc' }],
        take: BENCHMARK_TIERS.length,
    });

    // Keep only the newest date's rows; the query may straddle two days.
    const newest = latest[0];
    const current = newest
        ? latest
              .filter((r) => r.year === newest.year && r.month === newest.month && r.day === newest.day)
              .sort((a, b) => a.tier - b.tier)
              .map((r) => ({
                  tier: r.tier,
                  entry: toSafeNumber(r.entryValue),
                  average: toSafeNumber(r.avgValue),
              }))
        : [];

    return {
        club,
        current,
        history: history.map((point) => ({
            label: `Day ${point.day}`,
            byTier: Object.fromEntries(
                Object.entries(point.tiers).map(([tier, values]) => [Number(tier), values.entry]),
            ),
        })),
        historyNote:
            history.length < windowDays
                ? `History covers ${history.length} day${history.length === 1 ? '' : 's'}; uma.moe does not publish past circle totals, so it builds up from the first sync.`
                : null,
    };
}
