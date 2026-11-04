/**
 * An applicant's fan history, as plain numbers: no Discord, no network. The
 * scouting module fetches from uma.moe and hands the raw arrays here; tests
 * call these functions directly.
 *
 * Two sources, because uma.moe has no per-trainer daily endpoint:
 *
 *   - Daily: each circle's `daily_fans` holds the member's *lifetime* fan
 *     count at the end of each game day (index 0 is the month's starting
 *     value, index d is the end of game day d). Lifetime counts belong to the
 *     trainer, not the circle, so rows from different circles and months
 *     merge into one timeline, and a day's gain is the rise from the day
 *     before.
 *   - Monthly: the profile's `fan_history.monthly` holds each month's total
 *     gain across every circle the trainer was in that month.
 *
 * Averages are per calendar day, not per day with a gain. uma.moe's own
 * `avg_daily` divides by days with a gain, which rewards skipping days.
 */

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/** One circle's `daily_fans` row for one game month. */
export interface MonthRow {
    year: number;
    month: number;
    /** Lifetime fans per snapshot; zero or negative means no snapshot. */
    daily: number[];
}

/** One game day of the merged timeline. */
export interface DayGain {
    /** Days since 1970-01-01 of the game date; consecutive days differ by 1. */
    ordinal: number;
    year: number;
    month: number;
    /** Game day of the month, 1-based. */
    day: number;
    /** Fans gained that day. */
    gain: number;
    /**
     * True when no snapshot exists for this day or the day before, so the
     * gain is the rise across the gap spread evenly over its days. The sum
     * over the gap is exact; the split between its days is not.
     */
    estimated: boolean;
}

/** Days in a calendar month. A game month has as many days as its calendar month. */
export function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The ordinal of game day `index` of a game month. Index 0, the month's
 * starting value, falls on the previous month's last day, which is where it
 * belongs: it closes that day.
 */
export function dayOrdinal(year: number, month: number, index: number): number {
    return Math.round(Date.UTC(year, month - 1, index) / DAY_MS);
}

/** The game date of an ordinal. */
function dateOf(ordinal: number): { year: number; month: number; day: number } {
    const d = new Date(ordinal * DAY_MS);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Merges month rows into one day-by-day series of gains, oldest first.
 *
 * Every positive snapshot becomes a point on the timeline. Where two rows
 * have a point on the same day (a month's starting value and the previous
 * month's last day, or two circles in a month the trainer changed circle),
 * the higher value wins: lifetime counts never fall, so it is the later
 * reading. Indices past the month's length are ignored.
 *
 * Between two points one day apart the gain is their difference. Across a gap
 * (no snapshot on some days) the difference is spread evenly over the gap's
 * days and marked `estimated`. A fall between points counts as no gain. The
 * series starts the day after the first point and ends on the last.
 */
export function dailySeries(rows: MonthRow[]): DayGain[] {
    const points = new Map<number, number>();
    for (const row of rows) {
        const length = daysInMonth(row.year, row.month);
        row.daily.forEach((value, index) => {
            if (index > length || !(value > 0)) return;
            const ordinal = dayOrdinal(row.year, row.month, index);
            points.set(ordinal, Math.max(points.get(ordinal) ?? 0, value));
        });
    }
    const ordinals = [...points.keys()].sort((a, b) => a - b);
    const series: DayGain[] = [];
    for (let i = 1; i < ordinals.length; i += 1) {
        const from = ordinals[i - 1]!;
        const to = ordinals[i]!;
        const rise = Math.max(0, points.get(to)! - points.get(from)!);
        const span = to - from;
        for (let ordinal = from + 1; ordinal <= to; ordinal += 1) {
            series.push({ ordinal, ...dateOf(ordinal), gain: rise / span, estimated: span > 1 });
        }
    }
    return series;
}

/** An average over the latest days of a series. */
export interface WindowAverage {
    /** Fans per day; null when the series is empty. */
    perDay: number | null;
    /** Days averaged over; fewer than asked when the history is shorter. */
    days: number;
    /** Days in the window with a recorded (not estimated) gain above zero. */
    activeDays: number;
    /** Days in the window whose gain is spread across a gap. */
    estimatedDays: number;
    /** The window's days, oldest first. */
    window: DayGain[];
}

/** Average fans per day over the series' last `days` days. */
export function windowAverage(series: DayGain[], days = 30): WindowAverage {
    const window = series.slice(-days);
    if (window.length === 0) return { perDay: null, days: 0, activeDays: 0, estimatedDays: 0, window };
    const total = window.reduce((sum, d) => sum + d.gain, 0);
    return {
        perDay: total / window.length,
        days: window.length,
        activeDays: window.filter((d) => !d.estimated && d.gain > 0).length,
        estimatedDays: window.filter((d) => d.estimated).length,
        window,
    };
}

/** One month from the profile, as the bot reads it. */
export interface ProfileMonth {
    year: number;
    month: number;
    gain: number;
    /** uma.moe's days with a gain. */
    activeDays: number | null;
    /** The circle the month's row belongs to. */
    clubName?: string | null;
    /** That circle's rank tier that month: D, D+, C, C+, B, B+, A, A+, S, S+ or SS. */
    clubRank?: string | null;
    /** The trainer's place in uma.moe's monthly fan ranking. */
    fanRank?: number | null;
}

/** One month of the monthly view. */
export interface MonthSummary {
    year: number;
    month: number;
    /** Fans gained that month; null when uma.moe has no record of it. */
    gain: number | null;
    /** Calendar days the average divides by: the month's length, or days so far. */
    days: number;
    /** `gain / days`, or null without a record. */
    perDay: number | null;
    activeDays: number | null;
    clubName: string | null;
    clubRank: string | null;
    fanRank: number | null;
    /** The current game month, not finished yet. */
    inProgress: boolean;
    /**
     * The earliest month uma.moe has for this trainer. It may be partial (the
     * trainer started or joined a tracked circle mid-month), so a per-day
     * average over the whole month would understate them.
     */
    firstOnRecord: boolean;
}

/** The month `back` months before (year, month). */
export function monthsBefore(year: number, month: number, back: number): { year: number; month: number } {
    const index = year * 12 + (month - 1) - back;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * The last `count` game months, newest first, ending with the current one.
 *
 * @param now   The current game month and day (see `currentGameMonth`).
 * @param count Months to show, the current one included.
 */
export function monthSummaries(months: ProfileMonth[], now: { year: number; month: number; day: number }, count = 7): MonthSummary[] {
    const key = (y: number, m: number) => y * 12 + m;
    const byKey = new Map(months.map((m) => [key(m.year, m.month), m]));
    const earliest = months.length > 0 ? Math.min(...months.map((m) => key(m.year, m.month))) : null;
    const out: MonthSummary[] = [];
    for (let back = 0; back < count; back += 1) {
        const { year, month } = monthsBefore(now.year, now.month, back);
        const record = byKey.get(key(year, month));
        const inProgress = back === 0;
        // The current game day is not over, so it is not counted.
        const days = inProgress ? Math.max(1, now.day - 1) : daysInMonth(year, month);
        out.push({
            year,
            month,
            gain: record ? record.gain : null,
            days,
            perDay: record ? record.gain / days : null,
            activeDays: record?.activeDays ?? null,
            clubName: record?.clubName ?? null,
            clubRank: record?.clubRank ?? null,
            fanRank: record?.fanRank ?? null,
            inProgress,
            firstOnRecord: earliest !== null && key(year, month) === earliest,
        });
    }
    return out;
}

/** An average over several finished months. */
export interface MonthsAverage {
    perDay: number | null;
    /** Months that went into it. */
    months: number;
    /** Months asked for. */
    of: number;
}

/**
 * Average fans per calendar day over the last `count` finished months.
 *
 * The month in progress is left out. Months uma.moe has no record of are
 * left out rather than counted as zero: the trainer may have been in a circle
 * uma.moe does not track. The first month on record is left out too, unless
 * it is the only one, since it may be partial.
 */
export function monthsAverage(summaries: MonthSummary[], count: number): MonthsAverage {
    const finished = summaries.filter((s) => !s.inProgress).slice(0, count);
    let used = finished.filter((s) => s.gain !== null && !s.firstOnRecord);
    if (used.length === 0) used = finished.filter((s) => s.gain !== null);
    if (used.length === 0) return { perDay: null, months: 0, of: count };
    const gain = used.reduce((sum, s) => sum + s.gain!, 0);
    const days = used.reduce((sum, s) => sum + s.days, 0);
    return { perDay: gain / days, months: used.length, of: count };
}

/** A club as the fit check reads it. */
export interface FitClub {
    id: string;
    name: string;
    /** The club's quota per calendar day; zero or less means none is set. */
    quotaPerDay: number;
}

/** A club and whether an applicant's pace clears its quota. */
export interface ClubFit<C extends FitClub> {
    club: C;
    meets: boolean;
}

/**
 * Clubs with a quota, highest quota first, each marked by whether `perDay`
 * clears it. Clubs without a quota are left out: there is nothing to compare.
 */
export function clubFits<C extends FitClub>(perDay: number | null, clubs: C[]): ClubFit<C>[] {
    return clubs
        .filter((c) => c.quotaPerDay > 0)
        .sort((a, b) => b.quotaPerDay - a.quotaPerDay || a.name.localeCompare(b.name))
        .map((club) => ({ club, meets: perDay !== null && perDay >= club.quotaPerDay }));
}

/**
 * The trainer ID in an application, or null.
 *
 * Trainer IDs are 9 to 12 digits. Applicants write them bare, in brackets
 * ("[574910875032]"), or in groups split by spaces or dashes
 * ("574 910 875 032", "4674-9265-4277"). Longer digit runs (Discord IDs, 17+ digits) are not
 * IDs and are skipped. The title is checked before the body.
 */
export function extractTrainerId(...texts: (string | null | undefined)[]): string | null {
    for (const text of texts) {
        if (!text) continue;
        const bare = /(?<!\d)(\d{9,12})(?!\d)/.exec(text);
        if (bare) return bare[1]!;
        for (const match of text.matchAll(/(?<!\d)\d{2,6}(?:[ -]\d{2,6}){1,5}(?!\d)/g)) {
            const digits = match[0].replace(/[ -]/g, '');
            if (digits.length >= 9 && digits.length <= 12) return digits;
        }
    }
    return null;
}
