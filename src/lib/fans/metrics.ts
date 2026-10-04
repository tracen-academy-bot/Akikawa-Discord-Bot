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
 * A circle's quota applies to a *period*: a day, a week, two weeks, or the
 * whole month. Progress is measured inside the current window of that period:
 *
 *   MONTH     days 1 to month end (the original, reference-verified behaviour)
 *   BIWEEKLY  days 1-14, 15-28, then 29 to month end. Same rule as WEEK: the
 *             blocks restart on the 1st and the short last one scales its goal
 *             (a 3-day stub owes 3/14 of the quota).
 *   WEEK      days 1-7, 8-14, 15-21, 22-28, then 29 to month end. Weeks restart
 *             on the 1st, so the last one is short; its goal scales by its
 *             length (a 3-day week owes 3/7 of the weekly quota).
 *   DAY       the latest day with data
 *
 * Only current members count. A member with no snapshot on the circle's latest
 * snapshot has left and is dropped entirely, and a member's fans count only
 * while they are in the circle. See `currentMembers` and `monthGains`.
 *
 * In MONTH mode, for a circle nobody has left, every figure is identical to the
 * pre-period code.
 */

/** Window a quota is measured over. Mirrors the Prisma `QuotaPeriod` enum. */
export type QuotaPeriod = 'DAY' | 'WEEK' | 'BIWEEKLY' | 'MONTH';

/** A member's daily fan figures for one game month. */
export interface MemberSeries {
    viewerId: number;
    trainerName: string;
    /**
     * `daily_fans` straight from the API: the trainer's *lifetime* fan count,
     * one entry per snapshot. Index 0 is the month's starting value (taken at
     * the game-month start, the 2nd JST), and index i is that plus everything
     * earned over the first i game days. Zero means no snapshot: a day not yet
     * reached, or a day the member was not in the circle. See `monthGains`.
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
    /** Days in the window, through the latest day, that this member spent in the circle. */
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

/**
 * Length of a month's `daily_fans` array: the starting snapshot plus up to 31
 * game days. Longer arrays are not an error; JavaScript arrays grow.
 */
export const DAILY_FANS_LENGTH = 32;

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
    /**
     * Index d-1 is true when the member was in the circle for all of game day
     * d: they had a snapshot at its start and at its end. Only these days earn
     * fans and owe quota.
     */
    inCircle: boolean[];
}

/**
 * Which snapshot indices the circle has at all: index i is true when any
 * member has a non-zero value there.
 *
 * uma.moe scrapes a whole circle at once, so a missing value on an index that
 * other members have means that member was not in the circle at that moment,
 * while an index nobody has is a scrape that did not happen.
 */
export function circleSnapshots(raws: number[][]): boolean[] {
    const length = Math.max(0, ...raws.map((r) => r.length));
    return Array.from({ length }, (_, i) => raws.some((r) => (r[i] ?? 0) > 0));
}

/** Latest index the circle has a snapshot for, or -1 when it has none. */
export function latestSnapshot(scraped: boolean[]): number {
    return scraped.lastIndexOf(true);
}

/**
 * True when the member is in the circle as of its latest snapshot.
 *
 * Someone who left has no value there: uma.moe stops recording them, and the
 * bot's stored rows for them stop at the day they left. Either way they are
 * not a current member and are not counted at all. A circle with no snapshots
 * keeps everyone, which is nobody.
 */
export function isCurrentMember(raw: number[], scraped: boolean[]): boolean {
    const latest = latestSnapshot(scraped);
    return latest < 0 || (raw[latest] ?? 0) > 0;
}

/**
 * Turns uma.moe's lifetime snapshots into this month's gains.
 *
 * uma.moe's `daily_fans` holds lifetime fan counts, not counts that restart
 * each month: a trainer with 1.1B lifetime fans shows ~1.1B on every day.
 * The first snapshot of the month (index 0 for a member present from the
 * start, a later index for someone who joined mid-month) is the baseline,
 * and a day's gain is the rise from one snapshot to the next. For a member
 * present all month that totals exactly uma.moe's own "Monthly Gain"; for a
 * mid-month joiner it counts only fans earned after joining, which is why
 * they owe quota for one day fewer than their span of snapshots.
 *
 * `scraped` (from `circleSnapshots`) separates two kinds of hole:
 *
 *   - An index the whole circle is missing is a skipped scrape. The previous
 *     value carries forward, so it reads as a zero-gain day rather than a drop
 *     and a spike, and the member still counts as in the circle.
 *   - An index only this member is missing means they were out of the circle.
 *     Nothing earned across the gap counts; if they come back, counting
 *     restarts from their first snapshot after returning.
 *
 * Without `scraped`, every hole is treated as a skipped scrape.
 */
export function monthGains(raw: number[], scraped?: boolean[]): MonthGains {
    let first = -1;
    let last = -1;
    raw.forEach((v, i) => {
        if (v > 0) {
            if (first < 0) first = i;
            last = i;
        }
    });
    if (first < 0) return { gains: [], firstDay: 0, lastDay: 0, inCircle: [] };

    const gains = new Array<number>(last).fill(0);
    const inCircle = new Array<boolean>(last).fill(false);
    let earned = 0;
    // Latest value while in the circle; null after a day spent outside it.
    let carried: number | null = raw[first]!;
    for (let i = first + 1; i <= last; i += 1) {
        const v = raw[i] ?? 0;
        if (v > 0) {
            if (carried !== null) {
                // Lifetime counts never fall; treat a lower value as no gain.
                if (v > carried) earned += v - carried;
                inCircle[i - 1] = true;
                carried = Math.max(carried, v);
            } else {
                // Back in the circle: this snapshot is the new baseline.
                carried = v;
            }
        } else if (scraped?.[i]) {
            carried = null;
        } else if (carried !== null) {
            inCircle[i - 1] = true;
        }
        gains[i - 1] = earned;
    }
    return { gains, firstDay: first + 1, lastDay: last, inCircle };
}

/** One window of a period inside the game month. */
export interface PeriodWindow {
    start: number;
    end: number;
    /** 1-based block number in WEEK and BIWEEKLY mode; 1 otherwise. */
    index: number;
}

/**
 * The window containing `day` (1-based). Day 0, meaning "no data yet", is
 * treated as day 1 so an empty circle still has a sensible window.
 */
export function periodWindow(period: QuotaPeriod, day: number, daysInMonth: number): PeriodWindow {
    const d = Math.min(Math.max(1, day), daysInMonth);
    if (period === 'DAY') return { start: d, end: d, index: 1 };
    if (period === 'WEEK' || period === 'BIWEEKLY') {
        const length = periodLength(period);
        const index = Math.floor((d - 1) / length) + 1;
        const start = (index - 1) * length + 1;
        return { start, end: Math.min(start + length - 1, daysInMonth), index };
    }
    return { start: 1, end: daysInMonth, index: 1 };
}

/** Full length in days of a fixed-length period. MONTH varies, so it is excluded. */
function periodLength(period: 'DAY' | 'WEEK' | 'BIWEEKLY'): number {
    return period === 'DAY' ? 1 : period === 'WEEK' ? 7 : 14;
}

/** Per-day rate for a quota, floored. */
export function quotaPerDayFor(period: QuotaPeriod, quota: number, daysInMonth: number): number {
    if (period === 'MONTH') return Math.floor(quota / daysInMonth);
    return Math.floor(quota / periodLength(period));
}

/** Lower-case unit for a period, as in "80.0M per week". */
export function periodUnit(period: QuotaPeriod): string {
    return { DAY: 'day', WEEK: 'week', BIWEEKLY: '2 weeks', MONTH: 'month' }[period];
}

/** "Daily" / "Weekly" / "Biweekly" / "Monthly". */
export function periodAdjective(period: QuotaPeriod): string {
    return { DAY: 'Daily', WEEK: 'Weekly', BIWEEKLY: 'Biweekly', MONTH: 'Monthly' }[period];
}

/** e.g. "80.0M per week". */
export function describeQuota(quota: number, period: QuotaPeriod): string {
    return `${formatCompactFans(quota)} per ${periodUnit(period)}`;
}

/**
 * Label for a window, e.g. "Week 2 · days 8–14" or "Weeks 3–4 · days 15–28".
 * A biweekly window names the weekly weeks it covers, so the short stub at
 * month end reads "Week 5 · days 29–31", the same as in WEEK mode. MONTH
 * returns `monthName` as given.
 */
export function windowLabel(period: QuotaPeriod, window: PeriodWindow, monthName = 'Month'): string {
    if (period === 'DAY') return `Day ${window.start}`;
    if (period === 'MONTH') return monthName;
    const span = window.start === window.end ? `day ${window.start}` : `days ${window.start}–${window.end}`;
    const firstWeek = Math.floor((window.start - 1) / 7) + 1;
    const lastWeek = Math.floor((window.end - 1) / 7) + 1;
    const weeks = firstWeek === lastWeek ? `Week ${firstWeek}` : `Weeks ${firstWeek}–${lastWeek}`;
    return `${weeks} · ${span}`;
}

/**
 * Computes progress for every member of a circle.
 *
 * `daysElapsed` is taken from the data rather than from the wall clock: it is
 * the latest day any member has a total for. That keeps the report consistent
 * with whatever uma.moe has actually published, instead of showing an empty
 * column for a day that has not been ingested yet.
 *
 * Members who have left (see `isCurrentMember`) are dropped before anything is
 * computed: they appear nowhere and add nothing to the circle's totals.
 */
export function computeCircleProgress(series: MemberSeries[], options: QuotaOptions): CircleProgress {
    const { quota, daysInMonth } = options;
    const period = options.period ?? 'MONTH';
    const quotaDaysOffset = options.quotaDaysOffset ?? 0;

    // Only people in the circle now count; leavers vanish from every figure.
    const scraped = circleSnapshots(series.map((m) => m.dailyFans));
    const current = series.filter((m) => isCurrentMember(m.dailyFans, scraped));

    // Everything below works on fans earned in the circle, not lifetime totals.
    const month = new Map(current.map((m) => [m.viewerId, monthGains(m.dailyFans, scraped)]));
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

    const members = current.map<MemberProgress>((member) => {
        const g = gainsOf(member);
        const total = windowTotal(g, daysElapsed);

        // Quota is owed only for days spent in the circle: a mid-window joiner
        // from their first full day, and a returning member not for the gap.
        const firstDay = g.firstDay;
        let dataDays = 0;
        for (let day = window.start; day <= daysElapsed; day += 1) {
            if (g.inCircle[day - 1]) dataDays += 1;
        }
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
        const yesterday = current
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
