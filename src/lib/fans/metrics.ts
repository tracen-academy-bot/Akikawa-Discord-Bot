/**
 * Quota mathematics for circle fan tracking.
 *
 * The formulas here were derived from, and checked against, a reference report
 * produced by the bot this feature replaces. See `docs/quota-math.md` for the
 * verification, including which parts are confirmed exactly and which carry a
 * known open question.
 *
 * All figures are whole fans. Fractions are floored, never rounded, so a
 * trainer is never told they are on pace when they are one fan short.
 *
 * A circle's quota applies to a *period*: a day, a week, or the whole month.
 * Progress is measured inside the current window of that period:
 *
 *   MONTH  days 1 to month end (the original, reference-verified behaviour)
 *   WEEK   days 1-7, 8-14, 15-21, 22-28, then 29 to month end. Weeks restart
 *          on the 1st, so the last one is short; its goal scales by its
 *          length (a 3-day week owes 3/7 of the weekly quota).
 *   DAY    the latest day with data
 *
 * In MONTH mode every figure is identical to the pre-period code.
 */

/** Window a quota is measured over. Mirrors the Prisma `QuotaPeriod` enum. */
export type QuotaPeriod = 'DAY' | 'WEEK' | 'MONTH';

/** A member's daily fan figures for one game month. */
export interface MemberSeries {
    viewerId: number;
    trainerName: string;
    /**
     * `daily_fans` straight from the API: the trainer's *lifetime* fan count,
     * one entry per snapshot. Index 0 is the month's starting value (taken at
     * the game-month start, the 2nd JST), and index i is that plus everything
     * earned over the first i game days. Zero means no snapshot: a day not yet
     * reached, or before the member joined. See `monthGains`.
     */
    dailyFans: number[];
    shameScore: number | null;
}

/** Derived progress for one member. */
export interface MemberProgress {
    viewerId: number;
    trainerName: string;
    /** Fans earned inside the current window, as of the latest day with data. */
    total: number;
    /** Fans this member should have earned in the window by now. */
    expected: number;
    /** How far short of `expected` they are. Zero when on pace. */
    behind: number;
    /** Mean fans per day over their days with data inside the window. */
    avgPerDay: number;
    /** Fans per day needed to finish the window on quota. Null when on pace. */
    needPerDay: number | null;
    /** Fans gained on the most recent day. */
    latestDayGain: number;
    /** Days in the window from this member's first day with data through the latest day. */
    dataDays: number;
    /** Days counted toward `expected`. See `QuotaOptions.quotaDaysOffset`. */
    quotaDays: number;
    onPace: boolean;
    shameScore: number | null;
    /**
     * Fans gained on each of the last seven days with data, oldest first. Fewer
     * than seven entries when the member has less history. Drives the trend
     * sparkline; the shape matters more than the values.
     */
    recentGains: number[];
    /**
     * Where the member lands at the end of the window if their average holds:
     * `avgPerDay * windowDays`. A straight-line projection, deliberately
     * simple so it can be reasoned about at a glance.
     */
    projectedTotal: number;
    /** 1-based placement by window total. */
    rank: number;
    /**
     * Places gained since the previous day. Positive is an improvement,
     * negative a slip, zero no change. Null on the first day of a window,
     * when there is nothing to compare against.
     */
    rankChange: number | null;
}

/** Whole-circle derived figures. */
export interface CircleProgress {
    period: QuotaPeriod;
    /** The quota as configured, for the period. */
    quota: number;
    /** First and last day of the current window, 1-based and inclusive. */
    windowStart: number;
    windowEnd: number;
    /** e.g. "October", "Week 2 · days 8–14", "Day 9". Month name supplied by the caller. */
    windowLabel: string;
    /** Latest day of the game month that has data, 1-based. */
    daysElapsed: number;
    daysInMonth: number;
    /** Days left in the window, including today. */
    daysRemaining: number;
    /** Per-day rate: quota / days in month, quota / 7, or quota, floored. */
    quotaPerDay: number;
    /**
     * Each member's goal for the current window: `quotaPerDay * windowDays`.
     * In MONTH mode this sits slightly below the configured quota whenever it
     * does not divide evenly, which is what makes `needPerDay` agree with the
     * reference report exactly. In WEEK mode it is what scales a short week.
     */
    effectiveQuota: number;
    members: MemberProgress[];
    /** Sum of every member's window total. */
    totalFans: number;
    /** What the whole circle owes for the window: members times effective quota. */
    quotaTarget: number;
    /** Sum of every member's straight-line projection. */
    projectedTotalFans: number;
    /** Members currently at or ahead of expectation. */
    onPaceCount: number;
}

/** Tuning for quota calculations. */
export interface QuotaOptions {
    /** Fans each member is expected to earn per period. */
    quota: number;
    /** Period the quota applies to. Defaults to MONTH. */
    period?: QuotaPeriod;
    /** Window label in MONTH mode, e.g. "October". */
    monthName?: string;
    /** Length of the game month. Defaults to the calendar month's length. */
    daysInMonth: number;
    /**
     * Days subtracted from a member's `dataDays` when computing `expected`.
     *
     * The reference report counts a late-joining member's expectation from the
     * day *after* they appear, so their target is one day's quota lower than
     * their data span implies. That offset is exposed here rather than
     * hard-coded, because the underlying signal — the day a trainer joined the
     * circle — is not recoverable from `daily_fans` alone. Default 0 treats
     * every day with data as a day the member owed quota.
     */
    quotaDaysOffset?: number;
}

/** Days in a calendar month. `month` is 1-based. */
export function daysInCalendarMonth(year: number, month: number): number {
    // Day 0 of the next month is the last day of this one.
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Converts a Prisma BigInt to a number, refusing values that would lose
 * precision. Fan counts are int64 in the API but comfortably inside the safe
 * integer range in practice, so a failure here means something is wrong.
 */
export function toSafeNumber(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(-Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(`Fan count ${value} exceeds the safe integer range.`);
    }
    return Number(value);
}

/** A member's fans earned this month, derived from lifetime snapshots. */
export interface MonthGains {
    /** Index d-1 holds fans earned through game day d. Zero before `firstDay`. */
    gains: number[];
    /** First game day the member can earn (and owes quota) in this month; 0 if no data. */
    firstDay: number;
    /** Latest game day with a snapshot; 0 if only the starting value exists. */
    lastDay: number;
}

/**
 * Turns uma.moe's lifetime snapshots into this month's gains.
 *
 * uma.moe's `daily_fans` holds lifetime fan counts, not counts that restart
 * each month: a trainer with 1.1B lifetime fans shows ~1.1B on every day.
 * The first snapshot of the month (index 0 for a member present from the
 * start, a later index for someone who joined mid-month) is the baseline,
 * and the month's gain is the latest snapshot minus it. That is exactly
 * uma.moe's own "Monthly Gain", and it is why a mid-month joiner owes quota
 * for one day fewer than their span of snapshots.
 *
 * A missing snapshot inside the span carries the previous value forward, so
 * a missed sync reads as a zero-gain day rather than a drop and a spike.
 */
export function monthGains(raw: number[]): MonthGains {
    let first = -1;
    let last = -1;
    raw.forEach((v, i) => {
        if (v > 0) {
            if (first < 0) first = i;
            last = i;
        }
    });
    if (first < 0) return { gains: [], firstDay: 0, lastDay: 0 };

    const base = raw[first]!;
    const gains = new Array<number>(last).fill(0);
    let carried = base;
    for (let i = first + 1; i <= last; i += 1) {
        const v = raw[i] ?? 0;
        // Lifetime counts never fall; treat a lower or missing value as no gain.
        if (v > carried) carried = v;
        gains[i - 1] = carried - base;
    }
    return { gains, firstDay: first + 1, lastDay: last };
}

/** One window of a period inside the game month. */
export interface PeriodWindow {
    start: number;
    end: number;
    /** 1-based week number in WEEK mode; 1 otherwise. */
    index: number;
}

/**
 * The window containing `day` (1-based). Day 0, meaning "no data yet", is
 * treated as day 1 so an empty circle still has a sensible window.
 */
export function periodWindow(period: QuotaPeriod, day: number, daysInMonth: number): PeriodWindow {
    const d = Math.min(Math.max(1, day), daysInMonth);
    if (period === 'DAY') return { start: d, end: d, index: 1 };
    if (period === 'WEEK') {
        const index = Math.floor((d - 1) / 7) + 1;
        const start = (index - 1) * 7 + 1;
        return { start, end: Math.min(start + 6, daysInMonth), index };
    }
    return { start: 1, end: daysInMonth, index: 1 };
}

/** Per-day rate for a quota, floored. */
export function quotaPerDayFor(period: QuotaPeriod, quota: number, daysInMonth: number): number {
    if (period === 'DAY') return quota;
    if (period === 'WEEK') return Math.floor(quota / 7);
    return Math.floor(quota / daysInMonth);
}

/** Lower-case unit for a period, as in "80.0M per week". */
export function periodUnit(period: QuotaPeriod): string {
    return period === 'DAY' ? 'day' : period === 'WEEK' ? 'week' : 'month';
}

/** "Daily" / "Weekly" / "Monthly". */
export function periodAdjective(period: QuotaPeriod): string {
    return period === 'DAY' ? 'Daily' : period === 'WEEK' ? 'Weekly' : 'Monthly';
}

/** e.g. "80.0M per week". */
export function describeQuota(quota: number, period: QuotaPeriod): string {
    return `${formatCompactFans(quota)} per ${periodUnit(period)}`;
}

/** Label for a window, e.g. "Week 2 · days 8–14". MONTH returns `monthName` as given. */
export function windowLabel(period: QuotaPeriod, window: PeriodWindow, monthName = 'Month'): string {
    if (period === 'DAY') return `Day ${window.start}`;
    if (period === 'WEEK') {
        const span = window.start === window.end ? `day ${window.start}` : `days ${window.start}–${window.end}`;
        return `Week ${window.index} · ${span}`;
    }
    return monthName;
}

/**
 * Computes progress for every member of a circle.
 *
 * `daysElapsed` is taken from the data rather than from the wall clock: it is
 * the latest day any member has a total for. That keeps the report consistent
 * with whatever uma.moe has actually published, instead of showing an empty
 * column for a day that has not been ingested yet.
 */
export function computeCircleProgress(series: MemberSeries[], options: QuotaOptions): CircleProgress {
    const { quota, daysInMonth } = options;
    const period = options.period ?? 'MONTH';
    const quotaDaysOffset = options.quotaDaysOffset ?? 0;

    // Everything below works on fans earned this month, not lifetime totals.
    const month = new Map(series.map((m) => [m.viewerId, monthGains(m.dailyFans)]));
    const gainsOf = (m: MemberSeries) => month.get(m.viewerId)!;

    // Game days elapsed: the latest day any member has a snapshot for. Zero on
    // the first day of the month, when only starting values exist.
    const daysElapsed = Math.min(daysInMonth, Math.max(0, ...[...month.values()].map((g) => g.lastDay)));

    const window = periodWindow(period, daysElapsed, daysInMonth);
    const windowDays = window.end - window.start + 1;
    const quotaPerDay = quotaPerDayFor(period, quota, daysInMonth);
    const effectiveQuota = quotaPerDay * windowDays;
    // Before the first day has any data, today is still day 1.
    const daysRemaining = Math.max(0, window.end - Math.max(1, daysElapsed) + 1);

    /**
     * Fans earned this month through the end of `day`: zero before day 1,
     * and held at the member's latest value past their last snapshot.
     */
    const cumulativeAt = (g: MonthGains, day: number) =>
        day < 1 || g.lastDay === 0 ? 0 : (g.gains[Math.min(day, g.lastDay) - 1] ?? 0);
    /** Fans earned inside the window up to and including `day`. */
    const windowTotal = (g: MonthGains, day: number) =>
        Math.max(0, cumulativeAt(g, day) - cumulativeAt(g, window.start - 1));

    const members = series.map<MemberProgress>((member) => {
        const g = gainsOf(member);
        const total = windowTotal(g, daysElapsed);

        // A member who joined mid-window only owes quota from their first day.
        const firstDay = g.firstDay;
        const countFrom = Math.max(window.start, firstDay);
        const dataDays = firstDay === 0 || countFrom > daysElapsed ? 0 : Math.max(1, daysElapsed - countFrom + 1);
        const quotaDays = Math.max(0, dataDays - quotaDaysOffset);

        const expected = quotaPerDay * quotaDays;
        const behind = Math.max(0, expected - total);
        const avgPerDay = dataDays === 0 ? 0 : Math.floor(total / dataDays);

        const previous = cumulativeAt(g, daysElapsed - 1);
        // A cumulative series should never decrease; clamp in case it does.
        const latestDayGain = Math.max(0, cumulativeAt(g, daysElapsed) - previous);

        // Daily gains over the trailing week, from the member's first day with
        // data at the earliest. Deliberately not clipped to the window: the
        // sparkline shows momentum, which does not reset on a week boundary.
        const recentGains: number[] = [];
        const trendStart = Math.max(firstDay || 1, daysElapsed - 6);
        for (let day = trendStart; day <= daysElapsed; day += 1) {
            recentGains.push(Math.max(0, cumulativeAt(g, day) - cumulativeAt(g, day - 1)));
        }

        const onPace = behind === 0;
        const shortfall = Math.max(0, effectiveQuota - total);
        const needPerDay = onPace || daysRemaining === 0 ? null : Math.floor(shortfall / daysRemaining);

        return {
            viewerId: member.viewerId,
            trainerName: member.trainerName,
            total,
            expected,
            behind,
            avgPerDay,
            needPerDay,
            latestDayGain,
            recentGains,
            projectedTotal: avgPerDay * windowDays,
            dataDays,
            quotaDays,
            onPace,
            shameScore: member.shameScore,
            // Assigned after sorting, below.
            rank: 0,
            rankChange: null,
        };
    });

    // Highest window total first, matching how the reference report ranks members.
    members.sort((a, b) => b.total - a.total);

    // Yesterday's placement inside the same window, for the movement arrows.
    // Derived by re-ranking rather than stored, so it stays correct even if a
    // day was ingested late. None on a window's first day.
    const previousRanks = new Map<number, number>();
    if (daysElapsed - 1 >= window.start) {
        const yesterday = series
            .map((m) => ({ viewerId: m.viewerId, total: windowTotal(gainsOf(m), daysElapsed - 1) }))
            .filter((m) => m.total > 0)
            .sort((a, b) => b.total - a.total);
        yesterday.forEach((m, index) => previousRanks.set(m.viewerId, index + 1));
    }

    members.forEach((member, index) => {
        member.rank = index + 1;
        const previous = previousRanks.get(member.viewerId);
        member.rankChange = previous === undefined ? null : previous - member.rank;
    });

    return {
        period,
        quota,
        windowStart: window.start,
        windowEnd: window.end,
        windowLabel: windowLabel(period, window, options.monthName),
        daysElapsed,
        daysInMonth,
        daysRemaining,
        quotaPerDay,
        effectiveQuota,
        members,
        totalFans: members.reduce((sum, m) => sum + m.total, 0),
        quotaTarget: members.length * effectiveQuota,
        projectedTotalFans: members.reduce((sum, m) => sum + m.projectedTotal, 0),
        onPaceCount: members.filter((m) => m.onPace).length,
    };
}

/** Formats a fan count as "80.0M", "1.5B" or a plain number below a million. */
export function formatCompactFans(value: number): string {
    if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    return value.toLocaleString('en-US');
}

/** Formats a fan count with thousands separators, e.g. "113,157,048". */
export function formatFans(value: number): string {
    return value.toLocaleString('en-US');
}

/**
 * Formats a fan count in millions, e.g. "1531.5M".
 *
 * Circle totals reach the billions but are conventionally quoted in millions in
 * this game's community, so they are never rescaled to "B".
 */
export function formatMillionsFans(value: number): string {
    return `${(value / 1_000_000).toFixed(1)}M`;
}
