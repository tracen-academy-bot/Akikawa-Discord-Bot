import { getCircle, getCirclesAtRanks } from '../umamoe/client';
import type { UmaCircleMember } from '../umamoe/types';
import { circleSnapshots, latestSnapshot, monthGains } from './metrics';
import { currentGameMonth, monthsBefore } from './ingest';

/**
 * What it takes to keep up with T1000: fans per member per day over the last
 * 7 completed game days, for the circles ranked around 1000th by monthly
 * points on uma.moe. Shown under the non-Casual expected ranks in
 * `/club edit`, next to the quota it informs.
 *
 * One circle sitting exactly on 1000th is noisy, so the figure pools a band
 * 10% either side of the cutoff (900th to 1100th for T1000, 90th to 110th
 * for T100). Fetching every circle in a wide band would mean hundreds of
 * uma.moe requests, so at most 21 evenly spaced places are sampled (every
 * 10th from 900 to 1100; every place from 90 to 110).
 *
 * A day's figure is the fans all sampled circles' members earned that game
 * day, divided by how many members were in their circle all day, by the same
 * rules the club reports use (`monthGains`): a member counts only on days
 * they were in the circle, and a day either side of a skipped uma.moe scrape
 * is left out of that circle's figures rather than shown as nothing and then
 * double. Pooling (rather than averaging each circle's figure) keeps a small
 * circle from counting as much as a full one. The 7 days run back into last
 * month near the start of a month.
 *
 * These are the circles in the band now, not whichever were there on each
 * day; uma.moe's list only ranks the present. Opening a form must not wait on
 * uma.moe (Discord allows 3 seconds), so the figures are worked out by the
 * fan scheduler and kept in memory.
 */

/** The ranking place the figures are for. */
export const CUTOFF_RANK = 1000;
/** How far either side of the cutoff the band reaches, as a share of it. */
export const CUTOFF_BAND = 0.1;
/** Most places sampled in the band. */
export const CUTOFF_SAMPLES = 21;
/** How many completed game days to show. */
export const CUTOFF_DAYS = 7;
/** How old the figures may get before the hourly sync works them out again. */
export const CUTOFF_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** One game day's figure. */
export interface CutoffDay {
    year: number;
    month: number;
    day: number;
    /** Fans earned that day per member in their circle all day. */
    perMember: number;
    /** Members counted, across the sampled circles. */
    members: number;
}

/** The figures as last worked out. */
export interface CutoffSeries {
    rank: number;
    /** The band's first and last place. */
    from: number;
    to: number;
    /** Circles that contributed. */
    circles: number;
    /** Oldest first, at most `CUTOFF_DAYS`. */
    days: CutoffDay[];
    computedAt: Date;
}

let latest: CutoffSeries | null = null;

/** The figures as last worked out, or null before the first run succeeds. */
export function currentCutoff(): CutoffSeries | null {
    return latest;
}

/** Replaces the kept figures. For tests. */
export function setCutoffForTest(series: CutoffSeries | null): void {
    latest = series;
}

/**
 * The places sampled for a cutoff: up to `samples` evenly spaced from
 * `rank - band` to `rank + band`, ends included. T1000 gives 900, 910, ...,
 * 1100; T100 gives every place from 90 to 110.
 */
export function bandRanks(rank: number, band = CUTOFF_BAND, samples = CUTOFF_SAMPLES): number[] {
    const from = Math.max(1, Math.round(rank * (1 - band)));
    const to = Math.round(rank * (1 + band));
    const span = to - from;
    if (span + 1 <= samples) return Array.from({ length: span + 1 }, (_, i) => from + i);
    return [...new Set(Array.from({ length: samples }, (_, i) => from + Math.round((span * i) / (samples - 1))))];
}

/**
 * Fans earned and members counted for each completed game day of one
 * circle's month, from its members' `daily_fans` (index 0 the month's
 * start, index d the end of game day d). Days next to a skipped scrape, and
 * days with nobody in the circle, are left out.
 */
export function dailyTotals(raws: number[][]): { day: number; total: number; members: number }[] {
    const scraped = circleSnapshots(raws);
    const last = latestSnapshot(scraped);
    const series = raws.map((raw) => monthGains(raw, scraped));
    const out: { day: number; total: number; members: number }[] = [];
    for (let day = 1; day <= last; day += 1) {
        // A skipped scrape at either end makes the day read as 0 or as two days.
        if (!scraped[day] || !scraped[day - 1]) continue;
        let total = 0;
        let members = 0;
        for (const member of series) {
            if (!member.inCircle[day - 1]) continue;
            total += (member.gains[day - 1] ?? 0) - (day >= 2 ? member.gains[day - 2] ?? 0 : 0);
            members += 1;
        }
        if (members > 0) out.push({ day, total, members });
    }
    return out;
}

/** One circle's figures, per member: `dailyTotals` divided out. */
export function dailyPerMember(raws: number[][]): { day: number; perMember: number; members: number }[] {
    return dailyTotals(raws).map((d) => ({ day: d.day, perMember: Math.round(d.total / d.members), members: d.members }));
}

/** The members' `daily_fans`, for `dailyTotals`. */
function raws(members: UmaCircleMember[] | undefined): number[][] {
    return (members ?? []).map((m) => m.daily_fans ?? []);
}

/**
 * Samples the band around `CUTOFF_RANK` and works out the last
 * `CUTOFF_DAYS` days, keeping the result for `currentCutoff`.
 */
export async function refreshCutoff(now = new Date()): Promise<CutoffSeries> {
    const places = bandRanks(CUTOFF_RANK);
    const circles = [...(await getCirclesAtRanks(places)).values()].filter((c) => c.circle_id);
    if (circles.length === 0) throw new Error(`uma.moe has no circles ranked ${places[0]} to ${places.at(-1)}`);

    const { year, month } = currentGameMonth(now);
    const prev = monthsBefore(year, month, 1);
    // Pooled per game day, keyed "year-month-day".
    const pooled = new Map<string, { year: number; month: number; day: number; total: number; members: number }>();
    const add = (y: number, m: number, rows: { day: number; total: number; members: number }[]) => {
        for (const r of rows) {
            const key = `${y}-${m}-${r.day}`;
            const into = pooled.get(key) ?? { year: y, month: m, day: r.day, total: 0, members: 0 };
            into.total += r.total;
            into.members += r.members;
            pooled.set(key, into);
        }
    };

    let contributed = 0;
    for (const circle of circles) {
        const id = circle.circle_id!;
        const thisMonth = dailyTotals(raws((await getCircle(id, month, year)).members));
        add(year, month, thisMonth);
        if (thisMonth.length < CUTOFF_DAYS) add(prev.year, prev.month, dailyTotals(raws((await getCircle(id, prev.month, prev.year)).members)));
        contributed += 1;
    }

    const days = [...pooled.values()]
        .sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day)
        .map((d) => ({ year: d.year, month: d.month, day: d.day, perMember: Math.round(d.total / d.members), members: d.members }));

    latest = {
        rank: CUTOFF_RANK,
        from: places[0]!,
        to: places.at(-1)!,
        circles: contributed,
        days: days.slice(-CUTOFF_DAYS),
        computedAt: now,
    };
    return latest;
}

/** Works the figures out again when there are none or they are older than `CUTOFF_MAX_AGE_MS`. */
export async function refreshCutoffIfStale(now = new Date()): Promise<CutoffSeries | null> {
    if (latest && now.getTime() - latest.computedAt.getTime() < CUTOFF_MAX_AGE_MS) return null;
    return refreshCutoff(now);
}

/** A per-member figure as millions with two decimals: 1234567 is "1.23M". */
function millions(value: number): string {
    return `${(value / 1_000_000).toFixed(2)}M`;
}

/**
 * The figures in one line, oldest day first, short enough for a select
 * option's description (100 characters). Null when there are none.
 */
export function cutoffLine(series: CutoffSeries | null): string | null {
    if (!series || series.days.length === 0) return null;
    const line = `T${series.rank} (±10%) per member/day, last ${series.days.length} days: ${series.days.map((d) => millions(d.perMember)).join(' ')}`;
    return line.slice(0, 100);
}

/** The figures with their dates, for a message. Null when there are none. */
export function cutoffDetail(series: CutoffSeries | null): string | null {
    if (!series || series.days.length === 0) return null;
    const days = series.days.map((d) => `${d.month}/${d.day}: **${millions(d.perMember)}**`).join(' · ');
    return `T${series.rank} (${series.circles} circles ranked ${series.from}–${series.to}), fans per member per day: ${days}`;
}
