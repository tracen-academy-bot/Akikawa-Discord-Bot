import type { ClubRank, FanCountPeriod, TrackedCircle } from '@prisma/client';
import { daysInCalendarMonth, describeQuota, quotaPerDayFor, toSafeNumber } from './fans/metrics';
import { currentGameMonth } from './fans/ingest';

/**
 * How clubs' expected ranks and quotas read, shared by `/club` and the club
 * directory.
 */

export const RANK_CHOICES: { name: string; value: ClubRank }[] = [
    { name: 'Casual', value: 'CASUAL' },
    { name: 'B+', value: 'B_PLUS' },
    { name: 'A', value: 'A' },
    { name: 'A+', value: 'A_PLUS' },
    { name: 'S', value: 'S' },
    { name: 'S+', value: 'S_PLUS' },
];

export const PERIOD_CHOICES: { name: string; value: FanCountPeriod }[] = [
    { name: 'Day', value: 'DAY' },
    { name: 'Week', value: 'WEEK' },
    { name: 'Biweekly', value: 'BIWEEKLY' },
    { name: 'Month', value: 'MONTH' },
];

export function formatRank(rank: ClubRank | null): string {
    if (rank === null) return 'Not set';
    return RANK_CHOICES.find((r) => r.value === rank)?.name ?? rank;
}

function formatPeriod(period: FanCountPeriod): string {
    return PERIOD_CHOICES.find((p) => p.value === period)?.name.toLowerCase() ?? period.toLowerCase();
}

export function formatFanCount(amount: number | null, period: FanCountPeriod | null): string {
    if (amount === null) return 'Not set';
    const amountLabel = `${amount}M`;
    return period ? `${amountLabel}/${formatPeriod(period)}` : amountLabel;
}

/**
 * The club's fan quota as text. Clubs and circles share one quota since the
 * merge; an old club fan count is shown only if no quota was ever set.
 */
export function clubQuotaText(club: TrackedCircle): string {
    const quota = toSafeNumber(club.quota);
    if (quota > 0) return describeQuota(quota, club.quotaPeriod);
    return club.fanCountAmount === null ? 'Not set' : formatFanCount(club.fanCountAmount, club.fanCountPeriod);
}

/**
 * A club's effective daily requirement: fans each member must earn per day
 * to meet the quota, or null with no quota. A monthly quota is spread over
 * the current game month's days; weekly and 2-week quotas over 7 and 14.
 */
export function clubDailyRequirement(club: Pick<TrackedCircle, 'quota' | 'quotaPeriod'>, now = new Date()): number | null {
    const quota = toSafeNumber(club.quota);
    if (quota <= 0) return null;
    const { year, month } = currentGameMonth(now);
    return quotaPerDayFor(club.quotaPeriod, quota, daysInCalendarMonth(year, month));
}
