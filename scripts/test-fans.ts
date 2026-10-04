/**
 * Round-trip test for the fan tracking pipeline.
 *
 * The maths itself is covered by test-metrics.ts against a real reference
 * report. This suite covers the layer either side of it: writing snapshots and
 * reading them back into the same shapes the renderers consume. A bug here
 * would silently corrupt every report while the maths stayed correct.
 *
 *   DATABASE_URL=postgresql://... npm run test:fans
 */
import { assertDatabaseReady, prisma } from '../src/db/prisma';
import { loadCircleProgress } from '../src/lib/fans/ingest';
import { buildTrainerReport } from '../src/lib/fans/reports';
import { normalizeMember } from '../src/lib/fans/ingest';
import { parseQuota } from '../src/commands/fans';

const GUILD = 'test-guild-fans';
const YEAR = 2026;
const MONTH = 9;

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`);
}

async function main() {
    // ── Quota parsing ─────────────────────────────────────────────────────────
    check('parseQuota 80M', parseQuota('80M'), 80_000_000);
    check('parseQuota lowercase', parseQuota('80m'), 80_000_000);
    check('parseQuota fractional', parseQuota('2.5M'), 2_500_000);
    check('parseQuota billions', parseQuota('1.5B'), 1_500_000_000);
    check('parseQuota thousands', parseQuota('500k'), 500_000);
    check('parseQuota bare number', parseQuota('80000000'), 80_000_000);
    check('parseQuota with spaces', parseQuota('  80 M '), 80_000_000);
    check('parseQuota rejects words', parseQuota('lots'), null);
    check('parseQuota rejects empty', parseQuota(''), null);
    check('parseQuota rejects bad suffix', parseQuota('80X'), null);
    check('parseQuota uppercase K', parseQuota('500K'), 500_000);
    check('parseQuota thousands separators', parseQuota('80,000,000'), 80_000_000);
    check('parseQuota separators with suffix', parseQuota('1,500M'), 1_500_000_000);
    check('parseQuota rejects a misplaced comma', parseQuota('8,0M'), null);
    check('parseQuota rejects a decimal comma', parseQuota('1,5M'), null);

    // ── uma.moe members with fields omitted ──────────────────────────────────
    // The spec marks no field required. An omitted previous_circle_id used to
    // reach BigInt(undefined) and fail the whole sync with "Cannot convert
    // undefined to a BigInt" -- the first sync after adding a circle included.
    const fallback = { year: YEAR, month: MONTH };
    const sparse = normalizeMember({ viewer_id: 42, daily_fans: [0, 1_000, 2_500, 0] }, fallback);
    check('sparse member is kept', sparse !== null, true);
    check('omitted previous_circle_id becomes null', sparse?.previousCircleId, null);
    check('omitted next_month_start becomes null', sparse?.nextMonthStart, null);
    check('omitted name and shame become null', [sparse?.trainerName, sparse?.shameScore], [null, null]);
    check('omitted year and month fall back to the synced month', [sparse?.year, sparse?.month], [YEAR, MONTH]);
    check('only non-zero days are kept', sparse?.days, [{ day: 2, cumulativeFans: 1_000 }, { day: 3, cumulativeFans: 2_500 }]);
    check('explicit null is handled the same', normalizeMember({ viewer_id: 1, previous_circle_id: null, next_month_start: null }, fallback)?.previousCircleId, null);
    // check() compares via JSON, which cannot serialise BigInt; compare as text.
    check('present ids still convert', String(normalizeMember({ viewer_id: 7, previous_circle_id: 900, next_month_start: 5 }, fallback)?.previousCircleId), '900');
    check('member without viewer_id is skipped', normalizeMember({ trainer_name: 'ghost', daily_fans: [5] }, fallback), null);
    check('missing daily_fans means no days', normalizeMember({ viewer_id: 3 }, fallback)?.days, []);

    // ── Startup check ─────────────────────────────────────────────────────────
    // It names a table to prove migrations ran; the club merge renamed "Club",
    // so a stale name here would stop the bot starting on a migrated database.
    check('the startup check passes on a migrated database',
        await assertDatabaseReady().then(() => 'ready', (e: Error) => e.message), 'ready');

    // ── Seed a circle with two members ────────────────────────────────────────
    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    const circle = await prisma.trackedCircle.create({
        data: { guildId: GUILD, circleId: BigInt(999001), name: 'Testrose', quota: BigInt(80_000_000) },
    });

    // Steady earner: exactly 3,000,000 per day for 10 days.
    // Faller: 5,000,000/day for 5 days, then 500,000/day.
    const steady: number[] = [];
    const faller: number[] = [];
    for (let day = 1; day <= 10; day += 1) {
        steady.push(3_000_000 * day);
        faller.push(day <= 5 ? 5_000_000 * day : 25_000_000 + 500_000 * (day - 5));
    }

    // Stored rows are uma.moe's lifetime counts: stored day 1 is the month's
    // starting value, and stored day d + 1 adds what was earned through game
    // day d. So 10 game days of earnings take 11 rows.
    const BASE = 2_000_000_000;
    for (let stored = 1; stored <= 11; stored += 1) {
        const earned = (series: number[]) => (stored === 1 ? 0 : series[stored - 2]!);
        await prisma.fanSnapshot.create({
            data: {
                trackedCircleId: circle.id, viewerId: BigInt(1), trainerName: 'Steady',
                year: YEAR, month: MONTH, day: stored, cumulativeFans: BigInt(BASE + earned(steady)), shameScore: 4,
            },
        });
        await prisma.fanSnapshot.create({
            data: {
                trackedCircleId: circle.id, viewerId: BigInt(2), trainerName: 'ハルウララ',
                year: YEAR, month: MONTH, day: stored, cumulativeFans: BigInt(BASE + 7 + earned(faller)),
            },
        });
    }

    // A third member left after game day 5: their rows stop there. They must
    // not appear anywhere, so every figure below covers only the two above.
    for (let stored = 1; stored <= 6; stored += 1) {
        await prisma.fanSnapshot.create({
            data: {
                trackedCircleId: circle.id, viewerId: BigInt(3), trainerName: 'Leaver',
                year: YEAR, month: MONTH, day: stored, cumulativeFans: BigInt(BASE + 50_000_000 * stored),
            },
        });
    }
    check('a member who left has no trainer report',
        await buildTrainerReport(circle, BigInt(3), 7, null, { year: YEAR, month: MONTH }), null);

    // ── Read back as circle progress ──────────────────────────────────────────
    const progress = await loadCircleProgress(circle, YEAR, MONTH);
    if (!progress) throw new Error('loadCircleProgress returned null');

    check('days elapsed from snapshots', progress.daysElapsed, 10);
    check('days in September', progress.daysInMonth, 30);
    check('quota per day floored', progress.quotaPerDay, 2_666_666);
    check('two members loaded; the leaver is dropped', progress.members.length, 2);

    // Steady ends on 30.0M, the faller on 27.5M: the faller's early lead does
    // not survive five days at a tenth of the pace.
    check('ranked by total', progress.members.map((m) => m.trainerName), ['Steady', 'ハルウララ']);
    check('non-ASCII name survives the round trip', progress.members[1]?.trainerName, 'ハルウララ');

    const steadyRow = progress.members.find((m) => m.trainerName === 'Steady')!;
    check('steady total', steadyRow.total, 30_000_000);
    check('steady expected', steadyRow.expected, 2_666_666 * 10);
    check('steady avg/day', steadyRow.avgPerDay, 3_000_000);
    check('steady latest gain', steadyRow.latestDayGain, 3_000_000);
    check('steady is on pace', steadyRow.onPace, true);
    check('steady need/day withheld when on pace', steadyRow.needPerDay, null);
    check('shame score preserved', steadyRow.shameScore, 4);

    const fallerRow = progress.members.find((m) => m.trainerName === 'ハルウララ')!;
    check('faller total', fallerRow.total, 27_500_000);
    check('faller latest gain reflects the collapse', fallerRow.latestDayGain, 500_000);
    check('faller still on pace on cumulative', fallerRow.onPace, true);

    check('circle total', progress.totalFans, 57_500_000);

    // ── Trainer report ────────────────────────────────────────────────────────
    const report = await buildTrainerReport(circle, BigInt(2), 7, null, { year: YEAR, month: MONTH });
    if (!report) throw new Error('buildTrainerReport returned null');

    // A 7-day window over 10 days of data covers days 4-10, so it catches two
    // days at the old 5.0M pace before the collapse to 0.5M.
    check('report window length', report.dailyGains.length, 7);
    check('report plots gains, not cumulative totals',
        report.dailyGains.map((d) => d.gain),
        [5_000_000, 5_000_000, 500_000, 500_000, 500_000, 500_000, 500_000]);
    check('window fans', report.windowFans, 12_500_000);
    check('daily average', report.dailyAverage, Math.floor(12_500_000 / 7));
    check('goal covers exactly the plotted days', report.goal, 2_666_666 * 7);
    check('trainer name from snapshot', report.trainerName, 'ハルウララ');

    // ── Gap handling ──────────────────────────────────────────────────────────
    // Game day 9 is stored day 10 (stored day 1 is the starting value).
    // A day the whole circle is missing is a skipped scrape: it reads as a
    // zero-gain day and the next snapshot catches up, rather than a drop.
    await prisma.fanSnapshot.deleteMany({ where: { trackedCircleId: circle.id, day: 10 } });
    const skipped = await buildTrainerReport(circle, BigInt(1), 4, null, { year: YEAR, month: MONTH });
    check('a scrape the whole circle missed reads as zero gain, then catches up',
        skipped?.dailyGains.map((d) => d.gain),
        [3_000_000, 3_000_000, 0, 6_000_000]);

    // A day only this member is missing means they were out of the circle.
    // Nothing earned across the gap counts; counting restarts on their return.
    await prisma.fanSnapshot.create({
        data: { trackedCircleId: circle.id, viewerId: BigInt(2), year: YEAR, month: MONTH, day: 10, cumulativeFans: BigInt(BASE + 7 + faller[8]!) },
    });
    const absent = await buildTrainerReport(circle, BigInt(1), 4, null, { year: YEAR, month: MONTH });
    check('fans earned while out of the circle do not count',
        absent?.dailyGains.map((d) => d.gain),
        [3_000_000, 3_000_000, 0, 0]);

    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    await prisma.$disconnect();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
