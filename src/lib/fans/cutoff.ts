import { getCircle, getCircleAtRank } from '../umamoe/client';
import type { UmaCircleMember } from '../umamoe/types';
import { circleSnapshots, latestSnapshot, monthGains } from './metrics';
import { currentGameMonth, monthsBefore } from './ingest';

/**
 * What it takes to keep up with the T1000 circle: the circle currently 1000th
 * by monthly points on uma.moe, and what each of its members earned per day
 * over the last 7 completed game days. Shown under the non-Casual expected
 * ranks in `/club edit`, next to the quota it informs.
 *
 * One day's figure is the fans the circle's members earned that game day,
 * divided by how many members were in the circle all day, by the same rules
 * the club reports use (`monthGains`): a member counts only on days they were
 * in the circle, and a day either side of a skipped uma.moe scrape is left
 * out rather than shown as nothing and then double. The 7 days run back into
 * last month near the start of a month.
 *
 * It is the circle that is 1000th now, not whichever circle was 1000th on
 * each day; uma.moe's list only ranks the present. Opening a form must not
 * wait on uma.moe (Discord allows 3 seconds), so the figures are worked out
 * by the fan scheduler (at start and hourly) and kept in memory.
 */

/** The ranking place the figures are for. */
export const CUTOFF_RANK = 1000;
/** How many completed game days to show. */
export const CUTOFF_DAYS = 7;

/** One game day's figure. */
export interface CutoffDay {
    year: number;
    month: number;
    day: number;
    /** Fans earned that day per member in the circle all day. */
    perMember: number;
    /** Members in the circle all day. */
    members: number;
}

/** The T1000 figures as last worked out. */
export interface CutoffSeries {
    rank: number;
    circleId: number;
    circleName: string;
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
 * Fans per member for each completed game day of one month, from each
 * member's `daily_fans` (index 0 the month's start, index d the end of game
 * day d). Days with no member in the circle, and days next to a skipped
 * scrape, are left out.
 */
export function dailyPerMember(raws: number[][]): { day: number; perMember: number; members: number }[] {
    const scraped = circleSnapshots(raws);
    const last = latestSnapshot(scraped);
    const series = raws.map((raw) => monthGains(raw, scraped));
    const out: { day: number; perMember: number; members: number }[] = [];
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
        if (members > 0) out.push({ day, perMember: Math.round(total / members), members });
    }
    return out;
}

/** The members' `daily_fans`, for `dailyPerMember`. */
function raws(members: UmaCircleMember[] | undefined): number[][] {
    return (members ?? []).map((m) => m.daily_fans ?? []);
}

/**
 * Looks up the circle at `CUTOFF_RANK` and works out its last
 * `CUTOFF_DAYS` days, keeping the result for `currentCutoff`.
 */
export async function refreshCutoff(now = new Date()): Promise<CutoffSeries> {
    const circle = await getCircleAtRank(CUTOFF_RANK);
    if (!circle?.circle_id) throw new Error(`uma.moe has no circle at rank ${CUTOFF_RANK}`);

    const { year, month } = currentGameMonth(now);
    const thisMonth = await getCircle(circle.circle_id, month, year);
    let days: CutoffDay[] = dailyPerMember(raws(thisMonth.members)).map((d) => ({ year, month, ...d }));
    if (days.length < CUTOFF_DAYS) {
        const prev = monthsBefore(year, month, 1);
        const lastMonth = await getCircle(circle.circle_id, prev.month, prev.year);
        const before = dailyPerMember(raws(lastMonth.members)).map((d) => ({ ...prev, ...d }));
        days = [...before, ...days];
    }

    latest = {
        rank: CUTOFF_RANK,
        circleId: circle.circle_id,
        circleName: circle.name ?? `circle ${circle.circle_id}`,
        days: days.slice(-CUTOFF_DAYS),
        computedAt: now,
    };
    return latest;
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
    const line = `T${series.rank} per member/day, last ${series.days.length} days: ${series.days.map((d) => millions(d.perMember)).join(' ')}`;
    return line.slice(0, 100);
}

/** The figures with their dates, for a message. Null when there are none. */
export function cutoffDetail(series: CutoffSeries | null): string | null {
    if (!series || series.days.length === 0) return null;
    const days = series.days.map((d) => `${d.month}/${d.day}: **${millions(d.perMember)}**`).join(' · ');
    return `T${series.rank} (${series.circleName}), fans per member per day: ${days}`;
}
