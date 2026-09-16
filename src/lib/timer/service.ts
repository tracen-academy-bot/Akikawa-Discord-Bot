import type { TrainingTimer } from '@prisma/client';
import { prisma } from '../../db/prisma';

/**
 * Independent Training timer domain logic.
 *
 * One fixed duration is supported on purpose: Independent Training is a
 * specific 50-minute game mechanic, so arbitrary durations would model
 * something the bot is not for.
 *
 * Every timer is stored in Postgres rather than held in memory. That is what
 * lets a run survive a restart or a period of downtime: the scheduler reloads
 * outstanding timers on boot and fires anything already past its expiry,
 * instead of silently dropping it.
 */

/** Length of one Independent Training run. Not configurable by design. */
export const TRAINING_MINUTES = 50;

/** How long an expiry ping stays in the channel before it is deleted. */
export const NOTIFICATION_LIFETIME_MINUTES = 10;

/**
 * Timezone used to decide which calendar day a run belongs to, which in turn
 * defines daily counts and streaks. Defaults to JST, matching the game's
 * daily reset. Override with TIMER_STREAK_TIMEZONE (an IANA name).
 */
const STREAK_TIMEZONE = process.env.TIMER_STREAK_TIMEZONE ?? 'Asia/Tokyo';

/** Run counts that earn a callout in the expiry ping. */
const MILESTONES = [1, 10, 25, 50, 100, 250, 500, 1000, 2500] as const;

/** Aggregated statistics for one trainer in one guild. */
export interface TrainerStats {
    totalRuns: number;
    runsToday: number;
    runsThisWeek: number;
    /** Consecutive days, ending today or yesterday, with at least one run. */
    currentStreakDays: number;
    longestStreakDays: number;
    /** Total time trained, in minutes. */
    totalMinutes: number;
    /** 1-based placement by total runs, or null if this trainer has none. */
    rank: number | null;
    /** How many trainers in this guild have completed at least one run. */
    trainerCount: number;
    firstRunAt: Date | null;
}

/** One row of a leaderboard. */
export interface LeaderboardRow {
    discordUserId: string;
    runs: number;
    minutes: number;
}

export type LeaderboardPeriod = 'week' | 'month' | 'all';

// ─── Day bucketing ────────────────────────────────────────────────────────────

/**
 * Formats a timestamp as a `YYYY-MM-DD` key in the streak timezone.
 *
 * Streaks are counted in the player's game day, not UTC. Using `en-CA` yields
 * ISO-ordered output, so the keys sort and compare as plain strings.
 */
function dayKey(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: STREAK_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

/** Returns the `YYYY-MM-DD` key `offsetDays` before `from`. */
function shiftDayKey(from: Date, offsetDays: number): string {
    return dayKey(new Date(from.getTime() + offsetDays * 86_400_000));
}

/**
 * Counts consecutive days ending today (or yesterday) that contain a run.
 *
 * Yesterday is allowed as an endpoint so a streak is not reported as broken
 * partway through a day on which the trainer has not yet trained.
 */
function currentStreak(dayKeys: Set<string>, now: Date): number {
    // Anchor on whichever of today/yesterday has a run; otherwise the streak is 0.
    let cursor = 0;
    if (!dayKeys.has(shiftDayKey(now, 0))) {
        if (!dayKeys.has(shiftDayKey(now, -1))) return 0;
        cursor = -1;
    }

    let streak = 0;
    while (dayKeys.has(shiftDayKey(now, cursor))) {
        streak += 1;
        cursor -= 1;
    }
    return streak;
}

/** Finds the longest run of consecutive days present in the set. */
function longestStreak(dayKeys: Set<string>): number {
    const sorted = [...dayKeys].sort();
    let best = 0;
    let current = 0;
    let previous: string | null = null;

    for (const key of sorted) {
        // Comparing against the previous key's calendar successor avoids any
        // month-length or DST arithmetic.
        if (previous !== null && nextDayKey(previous) === key) {
            current += 1;
        } else {
            current = 1;
        }
        best = Math.max(best, current);
        previous = key;
    }
    return best;
}

/** Returns the calendar day after a `YYYY-MM-DD` key. */
function nextDayKey(key: string): string {
    // Parsed as UTC midnight so the +1 day step is exact; the result is
    // formatted back through the same UTC lens rather than a local timezone.
    const next = new Date(`${key}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
}

// ─── Timer lifecycle ──────────────────────────────────────────────────────────

/** Result of pressing Start. */
export interface StartResult {
    timer: TrainingTimer;
    /** True when an existing countdown was reset rather than a new one created. */
    wasReset: boolean;
}

/**
 * Starts a run, or resets the trainer's existing one back to a full duration.
 *
 * Matches the established behaviour of pressing Start twice: a trainer never
 * accumulates two concurrent countdowns.
 */
export async function startTimer(
    guildId: string,
    channelId: string,
    panelMessageId: string | null,
    discordUserId: string,
): Promise<StartResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TRAINING_MINUTES * 60_000);

    const existing = await prisma.trainingTimer.findUnique({
        where: { guildId_discordUserId: { guildId, discordUserId } },
    });

    const timer = await prisma.trainingTimer.upsert({
        where: { guildId_discordUserId: { guildId, discordUserId } },
        create: { guildId, channelId, panelMessageId, discordUserId, startedAt: now, expiresAt },
        update: { channelId, panelMessageId, startedAt: now, expiresAt },
    });

    return { timer, wasReset: existing !== null };
}

/** Cancels a trainer's run. Returns false when they had none. */
export async function stopTimer(guildId: string, discordUserId: string): Promise<boolean> {
    const { count } = await prisma.trainingTimer.deleteMany({ where: { guildId, discordUserId } });
    return count > 0;
}

/** Active timers for a guild, soonest to expire first. */
export function listActiveTimers(guildId: string): Promise<TrainingTimer[]> {
    return prisma.trainingTimer.findMany({ where: { guildId }, orderBy: { expiresAt: 'asc' } });
}

/**
 * Atomically removes and returns every timer that has reached zero.
 *
 * `DELETE ... RETURNING` is a single statement, so two overlapping scheduler
 * ticks cannot both claim the same timer and double-ping a trainer. Timers
 * that expired while the bot was offline are returned here on the first tick
 * after startup, which is what makes downtime recoverable rather than lossy.
 */
export function claimExpiredTimers(now: Date): Promise<TrainingTimer[]> {
    return prisma.$queryRaw<TrainingTimer[]>`
        DELETE FROM "TrainingTimer"
        WHERE "expiresAt" <= ${now}
        RETURNING *
    `;
}

/** What a completed run earned, for the expiry ping to mention. */
export interface CompletionSummary {
    totalRuns: number;
    currentStreakDays: number;
    /** Set when this run landed exactly on a milestone count. */
    milestone: number | null;
    /** True when this was the trainer's first run of the day. */
    firstOfDay: boolean;
    /** True when the current streak just reached a new personal best. */
    newLongestStreak: boolean;
}

/**
 * Records a finished run and reports what it earned.
 *
 * `completedAt` is the timer's scheduled expiry, not the delivery time, so a
 * ping delayed by downtime still counts toward the day it was actually earned.
 */
export async function recordRun(timer: TrainingTimer, deliveredAt: Date): Promise<CompletionSummary> {
    const completedAt = timer.expiresAt;
    const deliveryLagS = Math.max(0, Math.round((deliveredAt.getTime() - completedAt.getTime()) / 1000));

    await prisma.trainingRun.create({
        data: {
            guildId: timer.guildId,
            discordUserId: timer.discordUserId,
            startedAt: timer.startedAt,
            completedAt,
            deliveryLagS,
        },
    });

    const runs = await prisma.trainingRun.findMany({
        where: { guildId: timer.guildId, discordUserId: timer.discordUserId },
        select: { completedAt: true },
    });

    const keys = new Set(runs.map((r) => dayKey(r.completedAt)));
    const streak = currentStreak(keys, completedAt);
    const longest = longestStreak(keys);
    const runsOnThatDay = runs.filter((r) => dayKey(r.completedAt) === dayKey(completedAt)).length;

    return {
        totalRuns: runs.length,
        currentStreakDays: streak,
        milestone: (MILESTONES as readonly number[]).includes(runs.length) ? runs.length : null,
        firstOfDay: runsOnThatDay === 1,
        // Only a strictly-new best is worth celebrating; ties are not news.
        newLongestStreak: streak > 1 && streak === longest && runsOnThatDay === 1,
    };
}

// ─── Notifications ────────────────────────────────────────────────────────────

/** Schedules an expiry ping for automatic deletion. */
export async function scheduleNotificationDeletion(channelId: string, messageId: string): Promise<void> {
    await prisma.timerNotification.create({
        data: {
            channelId,
            messageId,
            deleteAt: new Date(Date.now() + NOTIFICATION_LIFETIME_MINUTES * 60_000),
        },
    });
}

/**
 * Atomically removes and returns notifications that are due for deletion.
 * Uses `DELETE ... RETURNING` for the same reason as `claimExpiredTimers`.
 */
export function claimExpiredNotifications(now: Date) {
    return prisma.$queryRaw<{ id: string; channelId: string; messageId: string }[]>`
        DELETE FROM "TimerNotification"
        WHERE "deleteAt" <= ${now}
        RETURNING id, "channelId", "messageId"
    `;
}

// ─── Statistics ───────────────────────────────────────────────────────────────

/** Start of the window for a leaderboard period, or null for all time. */
function periodStart(period: LeaderboardPeriod, now: Date): Date | null {
    if (period === 'all') return null;
    const days = period === 'week' ? 7 : 30;
    return new Date(now.getTime() - days * 86_400_000);
}

/** Builds the full statistics card for one trainer. */
export async function getTrainerStats(guildId: string, discordUserId: string): Promise<TrainerStats> {
    const now = new Date();

    const runs = await prisma.trainingRun.findMany({
        where: { guildId, discordUserId },
        select: { completedAt: true },
        orderBy: { completedAt: 'asc' },
    });

    const keys = new Set(runs.map((r) => dayKey(r.completedAt)));
    const todayKey = dayKey(now);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

    // Placement is computed over every trainer in the guild, so it reflects the
    // whole server rather than only those on the current leaderboard page.
    const totals = await prisma.trainingRun.groupBy({
        by: ['discordUserId'],
        where: { guildId },
        _count: { _all: true },
    });
    const ordered = totals.sort((a, b) => b._count._all - a._count._all);
    const index = ordered.findIndex((t) => t.discordUserId === discordUserId);

    return {
        totalRuns: runs.length,
        runsToday: runs.filter((r) => dayKey(r.completedAt) === todayKey).length,
        runsThisWeek: runs.filter((r) => r.completedAt >= weekAgo).length,
        currentStreakDays: currentStreak(keys, now),
        longestStreakDays: longestStreak(keys),
        totalMinutes: runs.length * TRAINING_MINUTES,
        rank: index === -1 ? null : index + 1,
        trainerCount: totals.length,
        firstRunAt: runs[0]?.completedAt ?? null,
    };
}

/** Top trainers by completed runs over the given period. */
export async function getLeaderboard(
    guildId: string,
    period: LeaderboardPeriod,
    limit = 15,
): Promise<LeaderboardRow[]> {
    const since = periodStart(period, new Date());

    const grouped = await prisma.trainingRun.groupBy({
        by: ['discordUserId'],
        where: { guildId, ...(since ? { completedAt: { gte: since } } : {}) },
        _count: { _all: true },
        orderBy: { _count: { discordUserId: 'desc' } },
        take: limit,
    });

    return grouped.map((row) => ({
        discordUserId: row.discordUserId,
        runs: row._count._all,
        minutes: row._count._all * TRAINING_MINUTES,
    }));
}

/** How many trainers are training right now, across the whole guild. */
export function countActiveTimers(guildId: string): Promise<number> {
    return prisma.trainingTimer.count({ where: { guildId } });
}

/**
 * Guild-wide numbers shown on the panel.
 *
 * "Today" is bounded by the streak timezone rather than UTC so the figure on
 * the panel agrees with the one on a trainer's stats card.
 */
export async function getPanelContext(guildId: string): Promise<{
    runsToday: number;
    topToday: { discordUserId: string; runs: number } | null;
}> {
    const now = new Date();
    const todayKey = dayKey(now);

    // A 48-hour window comfortably covers "today" in any timezone, and is then
    // filtered precisely by day key. Far cheaper than scanning all history.
    const recent = await prisma.trainingRun.findMany({
        where: { guildId, completedAt: { gte: new Date(now.getTime() - 2 * 86_400_000) } },
        select: { discordUserId: true, completedAt: true },
    });

    const today = recent.filter((r) => dayKey(r.completedAt) === todayKey);

    const perTrainer = new Map<string, number>();
    for (const run of today) {
        perTrainer.set(run.discordUserId, (perTrainer.get(run.discordUserId) ?? 0) + 1);
    }

    let topToday: { discordUserId: string; runs: number } | null = null;
    for (const [discordUserId, runs] of perTrainer) {
        if (!topToday || runs > topToday.runs) topToday = { discordUserId, runs };
    }

    return { runsToday: today.length, topToday };
}

/** One day's completed-run count, for the sparkline on a stats card. */
export interface DailyRunCount {
    /** `YYYY-MM-DD` in the streak timezone. */
    day: string;
    /** Short label for the chart axis, e.g. "09-16". */
    label: string;
    runs: number;
}

/**
 * Completed runs per day over the last `days` days, oldest first.
 *
 * Days with no runs are included as zeroes so the chart keeps an even time
 * axis rather than silently compressing gaps.
 */
export async function getDailyRunCounts(
    guildId: string,
    discordUserId: string,
    days = 14,
): Promise<DailyRunCount[]> {
    const now = new Date();
    const since = new Date(now.getTime() - days * 86_400_000);

    const runs = await prisma.trainingRun.findMany({
        where: { guildId, discordUserId, completedAt: { gte: since } },
        select: { completedAt: true },
    });

    const counts = new Map<string, number>();
    for (const run of runs) {
        const key = dayKey(run.completedAt);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const series: DailyRunCount[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const key = shiftDayKey(now, -offset);
        series.push({ day: key, label: key.slice(5), runs: counts.get(key) ?? 0 });
    }
    return series;
}
