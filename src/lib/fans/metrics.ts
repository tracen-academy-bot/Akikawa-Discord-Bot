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
 */

/** A member's daily cumulative totals for one game month. */
export interface MemberSeries {
    viewerId: number;
    trainerName: string;
    /**
     * Cumulative fan totals indexed by day, `daily_fans` straight from the API.
     * Index 0 is day 1. Days not yet reached, and days before the member
     * joined, are zero.
     */
    dailyFans: number[];
    shameScore: number | null;
}

/** Derived progress for one member. */
export interface MemberProgress {
    viewerId: number;
    trainerName: string;
    /** Cumulative fans as of the latest day with data. */
    total: number;
    /** Fans this member should have by now. */
    expected: number;
    /** How far short of `expected` they are. Zero when on pace. */
    behind: number;
    /** Mean fans per day over the days they have data for. */
    avgPerDay: number;
    /** Fans per day needed to finish the month on quota. Null when on pace. */
    needPerDay: number | null;
    /** Fans gained on the most recent day. */
    latestDayGain: number;
    /** Days from this member's first day with data through the latest day. */
    dataDays: number;
    /** Days counted toward `expected`. See `QuotaOptions.quotaDaysOffset`. */
    quotaDays: number;
    onPace: boolean;
    shameScore: number | null;
    /** 1-based placement by current total. */
    rank: number;
    /**
     * Places gained since the previous day. Positive is an improvement,
     * negative a slip, zero no change. Null on the first day of the month,
     * when there is nothing to compare against.
     */
    rankChange: number | null;
}

/** Whole-circle derived figures. */
export interface CircleProgress {
    /** Latest day of the game month that has data, 1-based. */
    daysElapsed: number;
    daysInMonth: number;
    /** Days left including today. */
    daysRemaining: number;
    /** Floor of the monthly quota divided by the days in the month. */
    quotaPerDay: number;
    /**
     * `quotaPerDay * daysInMonth`. Slightly below the configured monthly quota
     * whenever the quota does not divide evenly. Using this rather than the raw
     * quota is what makes `needPerDay` agree with the reference report exactly.
     */
    effectiveQuota: number;
    members: MemberProgress[];
    /** Sum of every member's cumulative total. */
    totalFans: number;
}

/** Tuning for quota calculations. */
export interface QuotaOptions {
    /** Fans each member is expected to earn across the whole month. */
    monthlyQuota: number;
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

/** Index of the last day with a non-zero total, 1-based. Zero if there is none. */
function lastDayWithData(dailyFans: number[]): number {
    for (let i = dailyFans.length - 1; i >= 0; i -= 1) {
        if ((dailyFans[i] ?? 0) > 0) return i + 1;
    }
    return 0;
}

/** Index of the first day with a non-zero total, 1-based. Zero if there is none. */
function firstDayWithData(dailyFans: number[]): number {
    for (let i = 0; i < dailyFans.length; i += 1) {
        if ((dailyFans[i] ?? 0) > 0) return i + 1;
    }
    return 0;
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
    const { monthlyQuota, daysInMonth } = options;
    const quotaDaysOffset = options.quotaDaysOffset ?? 0;

    const quotaPerDay = Math.floor(monthlyQuota / daysInMonth);
    const effectiveQuota = quotaPerDay * daysInMonth;

    const daysElapsed = Math.min(
        daysInMonth,
        Math.max(0, ...series.map((m) => lastDayWithData(m.dailyFans))),
    );
    const daysRemaining = Math.max(0, daysInMonth - daysElapsed + 1);

    const members = series.map<MemberProgress>((member) => {
        const total = member.dailyFans[daysElapsed - 1] ?? 0;

        const firstDay = firstDayWithData(member.dailyFans);
        const dataDays = firstDay === 0 ? 0 : Math.max(1, daysElapsed - firstDay + 1);
        const quotaDays = Math.max(0, dataDays - quotaDaysOffset);

        const expected = quotaPerDay * quotaDays;
        const behind = Math.max(0, expected - total);
        const avgPerDay = dataDays === 0 ? 0 : Math.floor(total / dataDays);

        const previous = daysElapsed >= 2 ? (member.dailyFans[daysElapsed - 2] ?? 0) : 0;
        // A cumulative series should never decrease; clamp in case it does.
        const latestDayGain = Math.max(0, total - previous);

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
            dataDays,
            quotaDays,
            onPace,
            shameScore: member.shameScore,
            // Assigned after sorting, below.
            rank: 0,
            rankChange: null,
        };
    });

    // Highest total first, matching how the reference report ranks members.
    members.sort((a, b) => b.total - a.total);

    // Yesterday's placement, for the movement arrows. Derived by re-ranking on
    // the previous day's cumulative totals rather than stored, so it stays
    // correct even if a day was ingested late.
    const previousRanks = new Map<number, number>();
    if (daysElapsed >= 2) {
        const yesterday = series
            .map((m) => ({ viewerId: m.viewerId, total: m.dailyFans[daysElapsed - 2] ?? 0 }))
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
        daysElapsed,
        daysInMonth,
        daysRemaining,
        quotaPerDay,
        effectiveQuota,
        members,
        totalFans: members.reduce((sum, m) => sum + m.total, 0),
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
