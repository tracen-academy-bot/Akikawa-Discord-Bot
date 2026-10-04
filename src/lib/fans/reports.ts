import type { TrackedCircle } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { BENCHMARK_TIERS, currentGameMonth, loadBenchmarkHistory, loadCircleProgress } from './ingest';
import {
    circleSnapshots,
    DAILY_FANS_LENGTH,
    daysInCalendarMonth,
    isCurrentMember,
    monthGains,
    quotaPerDayFor,
    toSafeNumber,
    type CircleProgress,
} from './metrics';
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

/** Months a circle has snapshots for, newest first. */
export async function listCircleMonths(circle: TrackedCircle): Promise<{ year: number; month: number }[]> {
    const rows = await prisma.fanSnapshot.groupBy({
        by: ['year', 'month'],
        where: { trackedCircleId: circle.id },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return rows.map((r) => ({ year: r.year, month: r.month }));
}

/**
 * Every member's lifetime snapshots for one month, keyed by viewer ID, as raw
 * `daily_fans` arrays (stored day k is index k-1).
 */
async function loadMonthRaw(circle: TrackedCircle, year: number, month: number): Promise<Map<string, number[]>> {
    const rows = await prisma.fanSnapshot.findMany({
        where: { trackedCircleId: circle.id, year, month },
        select: { viewerId: true, day: true, cumulativeFans: true },
    });
    const raw = new Map<string, number[]>();
    for (const row of rows) {
        const series = raw.get(String(row.viewerId)) ?? new Array<number>(DAILY_FANS_LENGTH).fill(0);
        series[row.day - 1] = toSafeNumber(row.cumulativeFans);
        raw.set(String(row.viewerId), series);
    }
    return raw;
}

/** Circle progress for the current game month, or null if nothing is ingested. */
export async function currentCircleProgress(circle: TrackedCircle): Promise<CircleProgress | null> {
    const { year, month } = currentGameMonth();
    return loadCircleProgress(circle, year, month);
}

/** Formats a game month as a report heading, e.g. "September 14, 2026". */
export function formatReportDate(year: number, month: number, day: number): string {
    // `day` is a game day; game day 1 is the 2nd of the calendar month.
    return new Date(Date.UTC(year, month - 1, day + 1)).toLocaleDateString('en-US', {
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
 *
 * Returns null for a trainer who has left the circle: leavers are not counted
 * anywhere, the same rule the circle report applies.
 */
export async function buildTrainerReport(
    circle: TrackedCircle,
    viewerId: bigint,
    windowDays = TRAINER_WINDOW_DAYS,
    /** Circle progress, when the caller has it; supplies rank and percentile. */
    progress: CircleProgress | null = null,
    /** Game month to report on. Defaults to the current one; tests pin it. */
    at: { year: number; month: number } = currentGameMonth(),
): Promise<TrainerReportData | null> {
    const { year, month } = at;

    const snapshots = await prisma.fanSnapshot.findMany({
        where: { trackedCircleId: circle.id, viewerId, year, month },
        orderBy: { day: 'asc' },
    });

    if (snapshots.length === 0) return null;

    // The whole circle's snapshot days tell a skipped scrape from a day this
    // trainer was out of the circle, and whether they are still in it.
    const scraped = circleSnapshots([...(await loadMonthRaw(circle, year, month)).values()]);

    // Snapshot rows hold lifetime counts; stored day k is index k-1.
    const raw = new Array<number>(DAILY_FANS_LENGTH).fill(0);
    let trainerName = viewerId.toString();
    let shameScore: number | null = null;
    let lastUpdated: Date | null = null;

    for (const snapshot of snapshots) {
        raw[snapshot.day - 1] = toSafeNumber(snapshot.cumulativeFans);
        if (snapshot.trainerName) trainerName = snapshot.trainerName;
        if (snapshot.shameScore !== null) shameScore = snapshot.shameScore;
        lastUpdated = snapshot.recordedAt;
    }

    if (!isCurrentMember(raw, scraped)) return null;

    // This month's gains by game day, counting only days in the circle. Missed
    // scrapes carry forward inside monthGains, so they read as zero-gain days
    // rather than spikes.
    const earned = monthGains(raw, scraped);
    const lastDay = earned.lastDay;
    const earnedThrough = (day: number) => (day < 1 ? 0 : (earned.gains[day - 1] ?? 0));
    const gainOn = (day: number) => Math.max(0, earnedThrough(day) - earnedThrough(day - 1));

    const firstDay = Math.max(earned.firstDay || 1, lastDay - windowDays + 1);
    const dailyGains: { label: string; gain: number }[] = [];
    for (let day = firstDay; day <= lastDay; day += 1) {
        dailyGains.push({ label: `Day ${day}`, gain: gainOn(day) });
    }

    const windowFans = dailyGains.reduce((sum, d) => sum + d.gain, 0);
    const daysInMonth = daysInCalendarMonth(year, month);
    // Per-day rate of whatever period the circle uses, so the chart's quota
    // line and the goal tile mean the same thing in every mode.
    const quotaPerDay = quotaPerDayFor(circle.quotaPeriod, toSafeNumber(circle.quota), daysInMonth);

    // Whole-month figures, independent of the plotted window.
    let bestDay: { label: string; gain: number } | null = null;
    let aboveQuotaStreak = 0;
    let streakOpen = true;
    for (let day = lastDay; day >= Math.max(1, earned.firstDay); day -= 1) {
        const gain = gainOn(day);
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
 * benchmark. Only current members count, and member count is taken per day,
 * so a mid-month join does not distort the rate for the days before it.
 */
async function clubRateByDay(circle: TrackedCircle): Promise<Record<number, number>> {
    const { year, month } = currentGameMonth();

    // Snapshots are lifetime counts; rates need fans earned in the circle.
    const raws = [...(await loadMonthRaw(circle, year, month)).values()];
    const scraped = circleSnapshots(raws);
    const members = raws.filter((r) => isCurrentMember(r, scraped)).map((r) => monthGains(r, scraped));
    const lastDay = Math.max(0, ...members.map((g) => g.lastDay));

    // Keyed by game day, the same day number the benchmark history uses
    // (currentGameMonth().day); the starting snapshot itself has no rate.
    const rateByDay: Record<number, number> = {};
    for (let day = 1; day <= lastDay; day += 1) {
        const present = members.filter((g) => g.firstDay > 0 && g.firstDay <= day && g.lastDay >= day);
        if (present.length === 0) continue;
        const earned = present.reduce((sum, g) => sum + (g.gains[day - 1] ?? 0), 0);
        rateByDay[day] = Math.floor(earned / present.length / day);
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
