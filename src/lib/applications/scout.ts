import { getCircle, getProfile } from '../umamoe/client';
import type { UmaCircleResponse, UmaProfileResponse } from '../umamoe/types';
import { currentGameMonth } from '../fans/ingest';
import {
    clubMonthStats,
    dailySeries,
    monthsAverage,
    monthsBefore,
    monthSummaries,
    windowAverage,
    type DayGain,
    type MonthRow,
    type MonthSummary,
    type MonthsAverage,
    type WindowAverage,
} from './history';

/**
 * Scouting an applicant: everything uma.moe knows about a trainer's recent
 * output, in one report. One profile request, then one request per circle
 * and month needed for the daily view (usually two to four).
 */

/** Days in the daily view. */
export const DAILY_WINDOW = 30;

/** Months in the monthly view, the current one included. */
export const MONTHS_SHOWN = 7;

/** What scouting found. */
export interface ScoutReport {
    viewerId: string;
    trainerName: string | null;
    /** The circle the trainer is in now, by name; null when in none. */
    currentCircle: string | null;
    /** Every day uma.moe has, oldest first. */
    daily: DayGain[];
    /** The last `DAILY_WINDOW` days. */
    recent: WindowAverage;
    /** Newest first, the current month included. */
    months: MonthSummary[];
    /** The last 3 finished months. */
    threeMonths: MonthsAverage;
    /** The last 6 finished months. */
    sixMonths: MonthsAverage;
    /** When uma.moe last updated the newest circle row read, if it said. */
    lastUpdated: Date | null;
}

/** The circle IDs to read for a game month, most likely first. */
function circlesFor(profile: UmaProfileResponse, year: number, month: number, current: boolean): number[] {
    const history = profile.circle_history ?? [];
    const at = (y: number, m: number) => history.find((h) => h.year === y && h.month === m)?.circle_id ?? null;
    const previous = monthsBefore(year, month, 1);
    const ids = [
        at(year, month),
        // A trainer who changed circle mid-month spent its first part in the
        // previous month's circle; `circle_history` names only one per month.
        at(previous.year, previous.month),
        current ? (profile.circle?.circle_id ?? null) : null,
    ];
    return [...new Set(ids.filter((id): id is number => typeof id === 'number' && id > 0))];
}

/**
 * Scouts a trainer. Null when uma.moe has no trainer with that ID. Throws
 * `UmaMoeError` when uma.moe cannot be reached or rejects the key; a failed
 * circle request only shortens the daily view.
 */
export async function scoutTrainer(viewerId: string, now = currentGameMonth()): Promise<ScoutReport | null> {
    const profile = await getProfile(viewerId);
    if (!profile) return null;

    // One request per circle and month, shared by the daily view and the
    // month table.
    const cache = new Map<string, Promise<UmaCircleResponse>>();
    const circle = (circleId: number, year: number, month: number) => {
        const key = `${circleId}:${year}-${month}`;
        if (!cache.has(key)) cache.set(key, getCircle(circleId, month, year));
        return cache.get(key)!;
    };

    const wanted = [now, { ...monthsBefore(now.year, now.month, 1), day: 0 }];
    const requests = wanted.flatMap((m, i) => circlesFor(profile, m.year, m.month, i === 0).map((circleId) => ({ circleId, year: m.year, month: m.month })));
    const responses = await Promise.allSettled(requests.map((r) => circle(r.circleId, r.year, r.month)));

    const rows: MonthRow[] = [];
    let lastUpdated: Date | null = null;
    responses.forEach((result, i) => {
        if (result.status !== 'fulfilled') {
            console.warn(`Scouting ${viewerId}: circle ${requests[i]!.circleId} ${requests[i]!.year}-${requests[i]!.month} failed:`, result.reason instanceof Error ? result.reason.message : result.reason);
            return;
        }
        const member = result.value.members?.find((m) => String(m.viewer_id) === viewerId);
        if (!member?.daily_fans) return;
        rows.push({ year: requests[i]!.year, month: requests[i]!.month, daily: member.daily_fans });
        const updated = member.last_updated ? new Date(member.last_updated) : null;
        if (updated && !Number.isNaN(updated.getTime()) && (!lastUpdated || updated > lastUpdated)) lastUpdated = updated;
    });

    const daily = dailySeries(rows);

    // The month table's months, each with its circle's member list for the
    // share of club and the average per day in it.
    const oldest = monthsBefore(now.year, now.month, MONTHS_SHOWN - 1);
    // Every month on record: the earliest one decides "first on record".
    const recorded = (profile.fan_history?.monthly ?? []).filter(
        (m) => typeof m.year === 'number' && typeof m.month === 'number' && typeof m.monthly_gain === 'number',
    );
    const shown = recorded.filter((m) => m.year! * 12 + m.month! >= oldest.year * 12 + oldest.month);
    const clubs = await Promise.all(
        shown.map(async (m) => {
            if (!m.circle_id) return null;
            try {
                const response = await circle(m.circle_id, m.year!, m.month!);
                const members = (response.members ?? [])
                    .filter((x) => x.viewer_id !== undefined && Array.isArray(x.daily_fans))
                    .map((x) => ({ viewerId: String(x.viewer_id), daily: x.daily_fans! }));
                return clubMonthStats(members, viewerId);
            } catch (e) {
                console.warn(`Scouting ${viewerId}: circle ${m.circle_id} ${m.year}-${m.month} failed:`, e instanceof Error ? e.message : e);
                return null;
            }
        }),
    );
    const clubOf = new Map(shown.map((m, i) => [m.year! * 12 + m.month!, clubs[i] ?? null]));
    const months = monthSummaries(
        recorded.map((m) => ({
            year: m.year!,
            month: m.month!,
            gain: m.monthly_gain!,
            activeDays: m.active_days ?? null,
            clubName: m.circle_name ?? null,
            clubRank: m.club_rank_name ?? null,
            club: clubOf.get(m.year! * 12 + m.month!) ?? null,
        })),
        now,
        MONTHS_SHOWN,
    );

    return {
        viewerId,
        trainerName: profile.trainer?.name ?? null,
        currentCircle: profile.circle?.name ?? null,
        daily,
        recent: windowAverage(daily, DAILY_WINDOW),
        months,
        threeMonths: monthsAverage(months, 3),
        sixMonths: monthsAverage(months, 6),
        lastUpdated,
    };
}

/** The pace a report is judged by: the last 30 days, else the last 3 months. */
export function headlinePace(report: ScoutReport): { perDay: number; basis: string } | null {
    if (report.recent.perDay !== null && report.recent.days >= 7) {
        return { perDay: report.recent.perDay, basis: `last ${report.recent.days} days` };
    }
    if (report.threeMonths.perDay !== null) {
        return { perDay: report.threeMonths.perDay, basis: `last ${report.threeMonths.months} month${report.threeMonths.months === 1 ? '' : 's'}` };
    }
    if (report.recent.perDay !== null) {
        return { perDay: report.recent.perDay, basis: `last ${report.recent.days} day${report.recent.days === 1 ? '' : 's'}` };
    }
    return null;
}
