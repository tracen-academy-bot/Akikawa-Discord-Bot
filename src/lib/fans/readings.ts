import { prisma } from '../../db/prisma';
import { toSafeNumber } from './metrics';

/**
 * Fans earned in the 24 hours before a report.
 *
 * Snapshots hold one total per member per game day and are overwritten on
 * every sync, so they cannot say what anyone had 24 hours ago. Each sync of
 * the current month therefore also records every member's lifetime total as
 * a reading, kept for two days. "Last 24h" is the newest batch of readings
 * minus the batch taken closest to 24 hours earlier.
 *
 * Totals are lifetime counts, so a window that crosses the month change still
 * works. Fans earned on the 1st from 17:00 to 24:00 JST do not count in the
 * game; a window overlapping that stretch is flagged, not adjusted.
 */

/** Readings older than this are deleted. */
const KEEP_MS = 2 * 86_400_000;
/** Length of the window. */
const WINDOW_MS = 86_400_000;
/** How far from exactly 24 hours earlier the older batch may be. Syncs are hourly. */
const TOLERANCE_MS = 90 * 60_000;

/** Records one sync's lifetime totals for a circle, and prunes old readings. */
export async function recordReadings(trackedCircleId: string, totals: { viewerId: bigint; total: number }[], takenAt = new Date()): Promise<void> {
    if (totals.length > 0) {
        await prisma.fanReading.createMany({
            data: totals.map((t) => ({ trackedCircleId, viewerId: t.viewerId, takenAt, total: BigInt(t.total) })),
        });
    }
    await prisma.fanReading.deleteMany({ where: { trackedCircleId, takenAt: { lt: new Date(takenAt.getTime() - KEEP_MS) } } });
}

/** Fans each member earned over a window, by viewer ID. */
export interface LastDayGains {
    from: Date;
    to: Date;
    gains: Map<number, number>;
    /** True when the window overlaps the 1st, 17:00–24:00 JST, when fans do not count. */
    overlapsFreeze: boolean;
}

/**
 * Fans earned in the 24 hours up to the newest reading at or before `at`.
 * Null until there are readings from about 24 hours before it.
 */
export async function lastDayGains(trackedCircleId: string, at = new Date()): Promise<LastDayGains | null> {
    const newest = await prisma.fanReading.findFirst({
        where: { trackedCircleId, takenAt: { lte: at } },
        orderBy: { takenAt: 'desc' },
        select: { takenAt: true },
    });
    if (!newest) return null;
    const to = newest.takenAt;
    const target = to.getTime() - WINDOW_MS;

    const candidates = await prisma.fanReading.findMany({
        where: { trackedCircleId, takenAt: { gte: new Date(target - TOLERANCE_MS), lte: new Date(target + TOLERANCE_MS) } },
        distinct: ['takenAt'],
        select: { takenAt: true },
    });
    if (candidates.length === 0) return null;
    const from = candidates.reduce((best, c) =>
        Math.abs(c.takenAt.getTime() - target) < Math.abs(best.takenAt.getTime() - target) ? c : best,
    ).takenAt;

    const [before, after] = await Promise.all(
        [from, to].map((takenAt) => prisma.fanReading.findMany({ where: { trackedCircleId, takenAt }, select: { viewerId: true, total: true } })),
    );
    const start = new Map(before!.map((r) => [toSafeNumber(r.viewerId), toSafeNumber(r.total)]));
    const gains = new Map<number, number>();
    for (const r of after!) {
        const viewerId = toSafeNumber(r.viewerId);
        const base = start.get(viewerId);
        if (base !== undefined) gains.set(viewerId, Math.max(0, toSafeNumber(r.total) - base));
    }
    return { from, to, gains, overlapsFreeze: overlapsFreeze(from, to) };
}

/**
 * True when [from, to] overlaps the 1st of a month, 17:00–24:00 JST: 08:00
 * to 15:00 UTC on the date that is the 1st in Japan.
 */
export function overlapsFreeze(from: Date, to: Date): boolean {
    // Every 1st whose freeze could touch the window: the months of both ends.
    for (const edge of [from, to]) {
        const jst = new Date(edge.getTime() + 9 * 3_600_000);
        const start = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1, 8);
        const end = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1, 15);
        if (from.getTime() < end && to.getTime() > start) return true;
    }
    return false;
}
