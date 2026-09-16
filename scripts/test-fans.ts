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
import { prisma } from '../src/db/prisma';
import { loadCircleProgress } from '../src/lib/fans/ingest';
import { buildTrainerReport } from '../src/lib/fans/reports';
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

    // ── Seed a circle with two members ────────────────────────────────────────
    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    const circle = await prisma.trackedCircle.create({
        data: { guildId: GUILD, circleId: BigInt(999001), name: 'Testrose', monthlyQuota: BigInt(80_000_000) },
    });

    // Steady earner: exactly 3,000,000 per day for 10 days.
    // Faller: 5,000,000/day for 5 days, then 500,000/day.
    const steady: number[] = [];
    const faller: number[] = [];
    for (let day = 1; day <= 10; day += 1) {
        steady.push(3_000_000 * day);
        faller.push(day <= 5 ? 5_000_000 * day : 25_000_000 + 500_000 * (day - 5));
    }

    for (let day = 1; day <= 10; day += 1) {
        await prisma.fanSnapshot.create({
            data: {
                trackedCircleId: circle.id, viewerId: BigInt(1), trainerName: 'Steady',
                year: YEAR, month: MONTH, day, cumulativeFans: BigInt(steady[day - 1]!), shameScore: 4,
            },
        });
        await prisma.fanSnapshot.create({
            data: {
                trackedCircleId: circle.id, viewerId: BigInt(2), trainerName: 'ハルウララ',
                year: YEAR, month: MONTH, day, cumulativeFans: BigInt(faller[day - 1]!),
            },
        });
    }

    // ── Read back as circle progress ──────────────────────────────────────────
    const progress = await loadCircleProgress(circle, YEAR, MONTH);
    if (!progress) throw new Error('loadCircleProgress returned null');

    check('days elapsed from snapshots', progress.daysElapsed, 10);
    check('days in September', progress.daysInMonth, 30);
    check('quota per day floored', progress.quotaPerDay, 2_666_666);
    check('two members loaded', progress.members.length, 2);

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
    const report = await buildTrainerReport(circle, BigInt(2), 7);
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

    // ── Gap handling: a missed sync must read as a zero-gain day ──────────────
    await prisma.fanSnapshot.deleteMany({
        where: { trackedCircleId: circle.id, viewerId: BigInt(1), day: 9 },
    });
    const gapped = await buildTrainerReport(circle, BigInt(1), 4);
    check('missing day reads as zero gain, not a spike',
        gapped?.dailyGains.map((d) => d.gain),
        [3_000_000, 3_000_000, 0, 6_000_000]);

    await prisma.trackedCircle.deleteMany({ where: { guildId: GUILD } });
    await prisma.$disconnect();

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
