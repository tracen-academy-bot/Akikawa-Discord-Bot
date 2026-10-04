import type { TrackedCircle } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { getCircle, getTopCircles, isConfigured } from '../umamoe/client';
import type { UmaCircleMember } from '../umamoe/types';
import {
    computeCircleProgress,
    DAILY_FANS_LENGTH,
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

/**
 * Current game year, month and day, in the game's timezone.
 *
 * The game month starts on the 2nd JST, not the 1st (uma.moe's API: "the
 * current game month starting at the 2nd JST"). The 1st is the previous
 * month's final day and the new month's starting snapshot, so on the 1st this
 * still returns the previous month, as uma.moe does. `day` is the game day:
 * the 2nd is day 1.
 */
export function currentGameMonth(now = new Date()): { year: number; month: number; day: number } {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: GAME_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);

    const [y, m, d] = parts.split('-').map(Number);
    // One calendar day back: the 2nd becomes day 1, the 1st the previous month's last.
    const game = new Date(Date.UTC(y!, m! - 1, d! - 1));
    return { year: game.getUTCFullYear(), month: game.getUTCMonth() + 1, day: game.getUTCDate() };
}

/** One member's fields as stored, with every optional API field resolved. */
export interface MemberRecord {
    viewerId: bigint;
    trainerName: string | null;
    shameScore: number | null;
    year: number;
    month: number;
    previousCircleId: bigint | null;
    previousCircleName: string | null;
    nextMonthStart: bigint | null;
    /** Days with a non-zero cumulative total, 1-based. */
    days: { day: number; cumulativeFans: number }[];
}

/** `BigInt` for a field the API may send as a number, `null`, or not at all. */
function optionalBigInt(value: number | null | undefined): bigint | null {
    return value === null || value === undefined ? null : BigInt(value);
}

/**
 * Resolves one raw uma.moe member into what gets stored.
 *
 * uma.moe's spec marks no field as required, so any of them can be absent.
 * Absent and `null` are treated alike. A member without a `viewer_id` cannot
 * be keyed and is skipped (returns null) rather than failing the whole sync;
 * a missing year or month falls back to the month that was requested.
 */
export function normalizeMember(member: UmaCircleMember, fallback: { year: number; month: number }): MemberRecord | null {
    if (member.viewer_id === null || member.viewer_id === undefined) return null;

    const days = (member.daily_fans ?? [])
        .map((cumulativeFans, index) => ({ day: index + 1, cumulativeFans }))
        .filter((row) => typeof row.cumulativeFans === 'number' && row.cumulativeFans > 0);

    return {
        viewerId: BigInt(member.viewer_id),
        trainerName: member.trainer_name ?? null,
        shameScore: member.shame_score ?? null,
        year: member.year ?? fallback.year,
        month: member.month ?? fallback.month,
        previousCircleId: optionalBigInt(member.previous_circle_id),
        previousCircleName: member.previous_circle_name ?? null,
        nextMonthStart: optionalBigInt(member.next_month_start),
        days,
    };
}

/**
 * Fetches one circle and writes its members' daily totals.
 *
 * Only days with a non-zero total are written. A zero means the day has not
 * happened yet, or the member was not in the circle, and storing those would
 * make an absent member indistinguishable from one who earned nothing.
 */
export async function syncCircle(
    circle: TrackedCircle,
    month?: number,
    year?: number,
    /** False when importing a past month, so its name and rank do not overwrite today's. */
    { updateCircle = true }: { updateCircle?: boolean } = {},
): Promise<SyncResult> {
    const circleId = toSafeNumber(circle.circleId);
    const response = await getCircle(circleId, month, year);

    if (!response.circle || response.circle.circle_id === undefined) {
        throw new Error(`uma.moe returned no circle for ID ${circleId}. Check the ID at uma.moe/circles.`);
    }

    const current = currentGameMonth();
    const fallback = { year: year ?? current.year, month: month ?? current.month };
    const members = (response.members ?? [])
        .map((m) => normalizeMember(m, fallback))
        .filter((m): m is MemberRecord => m !== null);

    let daysWritten = 0;

    for (const member of members) {
        const fields = {
            trainerName: member.trainerName,
            shameScore: member.shameScore,
            previousCircleId: member.previousCircleId,
            previousCircleName: member.previousCircleName,
            nextMonthStart: member.nextMonthStart,
        };

        for (const row of member.days) {
            await prisma.fanSnapshot.upsert({
                where: {
                    trackedCircleId_viewerId_year_month_day: {
                        trackedCircleId: circle.id,
                        viewerId: member.viewerId,
                        year: member.year,
                        month: member.month,
                        day: row.day,
                    },
                },
                create: {
                    trackedCircleId: circle.id,
                    viewerId: member.viewerId,
                    year: member.year,
                    month: member.month,
                    day: row.day,
                    cumulativeFans: BigInt(row.cumulativeFans),
                    ...fields,
                },
                update: { cumulativeFans: BigInt(row.cumulativeFans), ...fields },
            });
            daysWritten += 1;
        }
    }

    const name = response.circle.name ?? circle.name;
    if (updateCircle) {
        await prisma.trackedCircle.update({
            where: { id: circle.id },
            data: { name, monthlyRank: response.circle.monthly_rank ?? null, lastSyncedAt: new Date() },
        });
    }

    return { circleId, name, membersSeen: members.length, daysWritten };
}

/** How many past months a backfill reaches back, at most. */
export const BACKFILL_MONTHS = 12;

/** The game month `back` months before the given one. */
export function monthsBefore(year: number, month: number, back: number): { year: number; month: number } {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/**
 * Imports a circle's past months from uma.moe, newest first, stopping at the
 * first month with no members (the circle did not exist yet, or uma.moe keeps
 * no older history) or after BACKFILL_MONTHS. Snapshot writes are upserts, so
 * running it twice is harmless.
 *
 * @returns The months imported, as "YYYY-MM".
 */
export async function backfillCircle(circle: TrackedCircle, maxMonths = BACKFILL_MONTHS): Promise<string[]> {
    const { year, month } = currentGameMonth();
    const imported: string[] = [];
    for (let back = 1; back <= maxMonths; back += 1) {
        const target = monthsBefore(year, month, back);
        const result = await syncCircle(circle, target.month, target.year, { updateCircle: false });
        if (result.membersSeen === 0) break;
        imported.push(`${target.year}-${String(target.month).padStart(2, '0')}`);
    }
    return imported;
}

/**
 * Runs `backfillCircle` once per circle, ever. The marker is written before
 * the work so a crash or restart cannot start a second import alongside the
 * first; a failed import records its error and can be retried by deleting
 * the `backfill:<id>` JobRun row. Never throws.
 */
export async function backfillOnce(circle: TrackedCircle): Promise<void> {
    const id = `backfill:${circle.id}`;
    try {
        // Creating the marker is the lock: if two callers race (the hourly job
        // and an add-circle request), the second create fails and that caller
        // backs off. Callers fire this without awaiting, so it must not throw.
        await prisma.jobRun.create({ data: { id, lastRunAt: new Date(), note: 'started' } });
    } catch {
        return;
    }
    try {
        const months = await backfillCircle(circle);
        await prisma.jobRun.update({ where: { id }, data: { note: `imported ${months.length}: ${months.join(' ') || 'none'}` } });
        console.log(`Backfilled ${circle.name}: ${months.length} past month(s).`);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await prisma.jobRun.update({ where: { id }, data: { note: `failed: ${message}` } });
        console.error(`Backfill for ${circle.name} failed:`, message);
    }
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

    const now = currentGameMonth();
    const byViewer = new Map<string, MemberSeries>();

    for (const snapshot of snapshots) {
        const key = snapshot.viewerId.toString();
        let series = byViewer.get(key);
        if (!series) {
            series = {
                viewerId: toSafeNumber(snapshot.viewerId),
                trainerName: snapshot.trainerName ?? key,
                dailyFans: new Array<number>(DAILY_FANS_LENGTH).fill(0),
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
        quota: toSafeNumber(circle.quota),
        period: circle.quotaPeriod,
        monthName: new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
        daysInMonth: daysInCalendarMonth(year, month),
        quotaDaysOffset,
        // In the current month today is not over, so its checkpoint is still open.
        ...(year === now.year && month === now.month ? { currentDay: now.day } : {}),
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
