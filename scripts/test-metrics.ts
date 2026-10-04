/**
 * Verifies the quota mathematics against a real reference report.
 *
 * Fixtures are transcribed from an actual Freakrose leaderboard: September
 * 2026, day 14 of 30, quota 80.0M per member. Every member below was present
 * from day 1, so their expectation covers all 14 elapsed days; late joiners are
 * excluded here because their day count cannot be recovered from `daily_fans`
 * (see docs/quota-math.md).
 *
 *   npm run test:metrics
 */
import {
    circleSnapshots,
    computeCircleProgress,
    describeQuota,
    isCurrentMember,
    monthGains,
    periodWindow,
    type MemberSeries,
} from '../src/lib/fans/metrics';

const DAYS_IN_MONTH = 30;
const DAYS_ELAPSED = 14;
const MONTHLY_QUOTA = 80_000_000;

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
    const ok = actual === expected;
    ok ? pass++ : fail++;
    if (!ok) console.log(`FAIL  ${label}  got=${actual} want=${expected}`);
    return ok;
}

/** One transcribed row: [name, total, expected, behind, avgPerDay, needPerDay, day14Gain]. */
type Row = [string, number, number, number, number, number | null, number];

const ROWS: Row[] = [
    ['Yuna', 90_020_868, 37_333_324, 0, 6_430_062, null, 5_794_678],
    ['Shmooters', 76_938_064, 37_333_324, 0, 5_495_576, null, 6_021_257],
    ['coolboy98', 69_371_017, 37_333_324, 0, 4_955_072, null, 4_913_484],
    ['Etsuba', 68_382_800, 37_333_324, 0, 4_884_485, null, 5_211_562],
    ['YunSukKang', 66_976_101, 37_333_324, 0, 4_784_007, null, 5_980_949],
    ['Claw', 58_166_912, 37_333_324, 0, 4_154_779, null, 3_840_840],
    ['madlyy', 57_203_511, 37_333_324, 0, 4_085_965, null, 4_551_609],
    ['Lumi', 57_090_237, 37_333_324, 0, 4_077_874, null, 4_693_052],
    ['Hyli', 54_847_212, 37_333_324, 0, 3_917_658, null, 3_522_223],
    ['Kithighsan', 53_672_519, 37_333_324, 0, 3_833_751, null, 3_972_174],
    ['Portchi', 50_500_547, 37_333_324, 0, 3_607_181, null, 1_704_072],
    ['Tezo', 43_252_697, 37_333_324, 0, 3_089_478, null, 1_810_528],
    ['IIIIII', 41_058_591, 37_333_324, 0, 2_932_756, null, 0],
    ['Jords', 35_702_583, 37_333_324, 1_630_741, 2_550_184, 2_605_729, 2_843_995],
    ['Horikita', 35_680_030, 37_333_324, 1_653_294, 2_548_573, 2_607_055, 2_117_300],
    ['Sum', 35_288_335, 37_333_324, 2_044_989, 2_520_595, 2_630_096, 2_826_674],
    ['Solenne', 35_231_149, 37_333_324, 2_102_175, 2_516_510, 2_633_460, 7_068_049],
    ['Yurume2', 33_863_261, 37_333_324, 3_470_063, 2_418_804, 2_713_924, 1_732_834],
    ['chumchops', 32_353_425, 37_333_324, 4_979_899, 2_310_958, 2_802_738, 4_190_343],
    ['Safmcamer', 30_794_588, 37_333_324, 6_538_736, 2_199_613, 2_894_434, 3_097_113],
    ['Fwoxieee', 29_426_175, 37_333_324, 7_907_149, 2_101_869, 2_974_929, 1_637_411],
    ['Yang', 29_286_075, 37_333_324, 8_047_249, 2_091_862, 2_983_170, 1_678_482],
    ['Rinelle', 27_458_596, 37_333_324, 9_874_728, 1_961_328, 3_090_669, 743_040],
    ['San', 22_433_698, 37_333_324, 14_899_626, 1_602_407, 3_386_251, 525_104],
];

/**
 * Builds a 31-day cumulative series ending at `total` on day 14, where the
 * final day contributed `day14Gain`. Earlier days ramp evenly; only day 13 and
 * day 14 affect any assertion here.
 */
/**
 * Lifetime fan count every fixture member starts the month on. uma.moe's
 * `daily_fans` are lifetime counts: index 0 is this starting value and index
 * d is it plus what was earned over the first d game days.
 */
const LIFETIME_BASE = 1_000_000_000;

function buildSeries(name: string, index: number, total: number, day14Gain: number): MemberSeries {
    const dailyFans = new Array<number>(31).fill(0);
    const base = LIFETIME_BASE + index * 7_919;
    const day13 = total - day14Gain;
    dailyFans[0] = base;
    for (let day = 1; day <= 13; day += 1) {
        dailyFans[day] = base + Math.round((day13 * day) / 13);
    }
    dailyFans[14] = base + total;
    return { viewerId: index + 1, trainerName: name, dailyFans, shameScore: null };
}

/** A member earning `perDay` every day from `fromDay` through `toDay`. */
function steady(viewerId: number, perDay: number, toDay: number, fromDay = 1): MemberSeries {
    const dailyFans = new Array<number>(31).fill(0);
    // Starting snapshot the day before the member's first earning day.
    dailyFans[fromDay - 1] = LIFETIME_BASE;
    for (let day = fromDay; day <= toDay; day += 1) dailyFans[day] = LIFETIME_BASE + perDay * (day - fromDay + 1);
    return { viewerId, trainerName: `m${viewerId}`, dailyFans, shameScore: null };
}

/**
 * Daily and weekly quota periods. Weeks are days 1-7, 8-14, ... of the game
 * month; the last one is short and its goal scales by its length.
 */
function periodChecks() {
    const w = (p: Parameters<typeof periodWindow>[0], day: number, dim: number) => {
        const r = periodWindow(p, day, dim);
        return `${r.start}-${r.end}#${r.index}`;
    };
    check('week 1 is days 1-7', w('WEEK', 1, 31), '1-7#1');
    check('day 7 closes week 1', w('WEEK', 7, 31), '1-7#1');
    check('day 8 opens week 2', w('WEEK', 8, 31), '8-14#2');
    check('31-day month ends on a 3-day week', w('WEEK', 30, 31), '29-31#5');
    check('30-day month ends on a 2-day week', w('WEEK', 29, 30), '29-30#5');
    check('28-day February has four full weeks', w('WEEK', 28, 28), '22-28#4');
    check('no data yet sits in week 1', w('WEEK', 0, 30), '1-7#1');
    check('day window is the day itself', w('DAY', 9, 30), '9-9#1');
    check('month window is the whole month', w('MONTH', 9, 30), '1-30#1');

    // ── Checkpoints: the requirement steps up at each period end ─────────────
    // Weekly 14M, 31-day month. Checks at the end of days 7, 14, 21, 28, 31.
    const weekOpts = { quota: 14_000_000, period: 'WEEK' as const, daysInMonth: 31 };
    const w9 = computeCircleProgress([steady(1, 3_000_000, 9), steady(2, 1_000_000, 9)], weekOpts);
    const strong = w9.members.find((m) => m.viewerId === 1)!;
    const weak = w9.members.find((m) => m.viewerId === 2)!;
    check('totals are month-to-date, not per week', strong.total, 27_000_000);
    check('last check passed was day 7', w9.checkpointDay, 7);
    check('next check is day 14', w9.nextCheckpointDay, 14);
    check('the current period is week 2', w9.windowLabel, 'Week 2 · days 8–14');
    check('due at the day 7 check is one weekly quota', strong.expected, 14_000_000);
    check('due by day 14 is two', strong.target, 28_000_000);
    check('made the day 7 check', strong.onPace, true);
    check('need/day aims at the next check', strong.needPerDay, 200_000);
    check('days until the next check', w9.daysRemaining, 5);
    check('missed the day 7 check', weak.behind, 5_000_000);
    check('month-end requirement scales the 3-day stub', w9.effectiveQuota, 62_000_000);
    check('rank movement compares with yesterday', w9.members.map((m) => m.rankChange).join(','), '0,0');

    // Before the first check nobody is behind, however slow.
    const w5 = computeCircleProgress([steady(1, 1_000_000, 5)], weekOpts);
    check('nobody is behind before the first check', w5.members[0]!.behind, 0);
    check('nothing is due before the first check', w5.members[0]!.expected, 0);
    check('need/day spreads the first week', w5.members[0]!.needPerDay, 4_500_000);

    // Today is not over, so its checkpoint is not judged yet.
    const open7 = computeCircleProgress([steady(1, 1_000_000, 7)], { ...weekOpts, currentDay: 7 });
    check('day 7 in progress: week 1 not judged', open7.checkpointDay, 0);
    check('day 7 in progress: not behind', open7.members[0]!.behind, 0);
    check('day 7 in progress: last day to make it', open7.daysRemaining, 1);
    const closed = computeCircleProgress([steady(1, 1_000_000, 8)], { ...weekOpts, currentDay: 8 });
    check('day 8: week 1 judged', closed.checkpointDay, 7);
    check('day 8: the check has just closed', closed.checkpointJustClosed, true);
    check('day 8: behind on week 1', closed.members[0]!.behind, 6_000_000);
    const later = computeCircleProgress([steady(1, 1_000_000, 9)], { ...weekOpts, currentDay: 9 });
    check('day 9: the check is no longer fresh', later.checkpointJustClosed, false);

    // A finished month is judged at its last day, stub included.
    const done = computeCircleProgress([steady(1, 2_000_000, 31)], weekOpts);
    check('a finished month is judged at month end', done.checkpointDay, 31);
    check('62M was due by month end', done.members[0]!.expected, 62_000_000);
    check('exactly enough is on pace', done.members[0]!.onPace, true);
    check('nothing left to do in a finished month', done.members[0]!.needPerDay, null);

    // A day-10 joiner owes only their days in the circle: 5 of week 2's 7.
    const joined = computeCircleProgress([steady(1, 3_000_000, 16), steady(2, 3_000_000, 16, 10)], weekOpts);
    const late = joined.members.find((m) => m.viewerId === 2)!;
    check('a joiner owes their share of the week they joined', late.expected, 10_000_000);
    check('a joiner counts days in the circle', late.quotaDays, 5);

    // Daily 2.5M: 2.5M due by end of day 1, 5M by end of day 2, and so on.
    const dayOpts = { quota: 2_500_000, period: 'DAY' as const, daysInMonth: 30 };
    const d5 = computeCircleProgress([steady(1, 2_000_000, 5)], dayOpts);
    check('daily: due by end of day 5 is 12.5M', d5.members[0]!.expected, 12_500_000);
    check('daily: 10M earned is 2.5M behind', d5.members[0]!.behind, 2_500_000);
    check('daily: next check is day 6, 15M', `${d5.nextCheckpointDay}:${d5.nextCheckpointTarget}`, '6:15000000');
    check('daily label names the day being checked next', d5.windowLabel, 'Day 6');
    const dLive = computeCircleProgress([steady(1, 2_000_000, 5)], { ...dayOpts, currentDay: 5 });
    check('daily, day 5 in progress: judged through day 4', dLive.members[0]!.expected, 10_000_000);
    check('daily, day 5 in progress: not behind yet', dLive.members[0]!.behind, 0);
    check('daily, day 5 in progress: 2.5M more today', dLive.members[0]!.needPerDay, 2_500_000);

    // MONTH stays the default, labelled with the month name when given.
    const month = computeCircleProgress([steady(1, 3_000_000, 5)], { quota: 90_000_000, daysInMonth: 30, monthName: 'October' });
    check('month is the default period', month.period, 'MONTH');
    check('month label is the month name', month.windowLabel, 'October');
}

/**
 * Biweekly: days 1-14, 15-28, then a short stub to month end, restarting on
 * the 1st like weeks do. The stub's goal scales by its length.
 */
function biweeklyChecks() {
    const w = (day: number, dim: number) => {
        const r = periodWindow('BIWEEKLY', day, dim);
        return `${r.start}-${r.end}#${r.index}`;
    };
    check('biweekly 1 is days 1-14', w(1, 31), '1-14#1');
    check('day 14 closes biweekly 1', w(14, 31), '1-14#1');
    check('day 15 opens biweekly 2', w(15, 31), '15-28#2');
    check('31-day month ends on a 3-day stub', w(30, 31), '29-31#3');
    check('30-day month ends on a 2-day stub', w(29, 30), '29-30#3');
    check('28-day February is exactly two', w(28, 28), '15-28#2');
    check('biweekly quota text', describeQuota(160_000_000, 'BIWEEKLY'), '160.0M per 2 weeks');

    // Biweekly 28M: due 28M by end of day 14, 56M by day 28, scaled to month end.
    const bOpts = { quota: 28_000_000, period: 'BIWEEKLY' as const, daysInMonth: 31 };
    const b16 = computeCircleProgress([steady(1, 2_000_000, 16)], bOpts);
    const bm = b16.members[0]!;
    check('biweekly label names its weeks', b16.windowLabel, 'Weeks 3–4 · days 15–28');
    check('biweekly per-day rate', b16.quotaPerDay, 2_000_000);
    check('biweekly totals are month-to-date', bm.total, 32_000_000);
    check('biweekly: 28M due at the day 14 check', bm.expected, 28_000_000);
    check('biweekly: 56M due by day 28', bm.target, 56_000_000);
    check('biweekly days until the next check', b16.daysRemaining, 12);
    check('biweekly need/day', bm.needPerDay, 2_000_000);
    const bDone = computeCircleProgress([steady(1, 2_000_000, 31)], bOpts);
    check('biweekly 3-day stub scales: 62M due at month end', bDone.members[0]!.expected, 62_000_000);
    const bLabel = computeCircleProgress([steady(1, 2_000_000, 30)], { ...bOpts, currentDay: 30 });
    check('biweekly stub label', bLabel.windowLabel, 'Week 5 · days 29–31');
}

/**
 * Only current members count, and only fans earned while in the circle.
 * uma.moe scrapes a whole circle at once, so a value missing for one member
 * on a day others have means that member was out of the circle.
 */
function membershipChecks() {
    const opts = { quota: 300_000_000, daysInMonth: 30 };

    // Member 2 left after game day 6; member 1 is still in on day 12.
    const left = computeCircleProgress([steady(1, 10_000_000, 12), steady(2, 10_000_000, 6)], opts);
    check('a leaver is dropped', left.members.length, 1);
    check('a leaver is not in the list', left.members.some((m) => m.viewerId === 2), false);
    check('a leaver adds nothing to the circle total', left.totalFans, 120_000_000);
    check('a leaver adds nothing to the circle target', left.quotaTarget, left.effectiveQuota);
    check('days elapsed still comes from current members', left.daysElapsed, 12);

    // Member 2 joined on game day 10: only fans from then on count.
    const joined = computeCircleProgress([steady(1, 10_000_000, 12), steady(2, 10_000_000, 12, 10)], opts);
    const joiner = joined.members.find((m) => m.viewerId === 2)!;
    check('a joiner counts only fans since joining', joiner.total, 30_000_000);
    check('a joiner owes quota only since joining', joiner.dataDays, 3);

    // Member 2 left after day 4, was out for indices 5-7 while earning 100M
    // elsewhere, and came back at index 8. The gap and the 100M do not count.
    const away = steady(2, 10_000_000, 12);
    for (let i = 5; i <= 7; i += 1) away.dailyFans[i] = 0;
    for (let i = 8; i <= 12; i += 1) away.dailyFans[i] = away.dailyFans[i]! + 100_000_000;
    const back = computeCircleProgress([steady(1, 10_000_000, 12), away], opts);
    const returner = back.members.find((m) => m.viewerId === 2)!;
    check('a returning member counts only days in the circle', returner.total, 80_000_000);
    check('a returning member owes quota only for days in the circle', returner.dataDays, 8);
    check('a returning member expected', returner.expected, back.quotaPerDay * 8);

    // Index 6 missing for everyone is a skipped scrape, not a mass exodus.
    const a = steady(1, 10_000_000, 12);
    const b = steady(2, 10_000_000, 12);
    a.dailyFans[6] = 0;
    b.dailyFans[6] = 0;
    const skipped = computeCircleProgress([a, b], opts);
    check('a skipped scrape keeps everyone', skipped.members.length, 2);
    check('a skipped scrape loses no fans', skipped.members[0]!.total, 120_000_000);
    check('a skipped scrape still owes quota', skipped.members[0]!.dataDays, 12);

    // Building blocks.
    check('no snapshots keeps everyone (nobody)', isCurrentMember([], circleSnapshots([])), true);
    const carried = monthGains([5, 6, 0, 8]);
    check('without circle context a hole carries forward', carried.gains.join(','), '1,1,3');
    check('without circle context a hole is still in the circle', carried.inCircle.join(','), 'true,true,true');
}

/**
 * uma.moe sends lifetime fan counts. Production once reported fish@duck at
 * 1,122,234,894 "fans this month" on day 1, while uma.moe's own page showed
 * a monthly gain of +258,774. These pin the month to its starting snapshot.
 */
function lifetimeChecks() {
    const raw = (values: number[]) => [...values, ...new Array<number>(31 - values.length).fill(0)];
    const member = (viewerId: number, values: number[]): MemberSeries => ({ viewerId, trainerName: `l${viewerId}`, dailyFans: raw(values), shameScore: null });

    // fish@duck, from the uma.moe circle page on 2026-10-01.
    const fish = computeCircleProgress([member(1, [1_121_976_120, 1_122_234_894])], { quota: 240_000_000, daysInMonth: 31 });
    check('monthly gain matches uma.moe, not the lifetime count', fish.members[0]!.total, 258_774);
    check('one game day elapsed after the starting snapshot', fish.daysElapsed, 1);
    check('latest day gain', fish.members[0]!.latestDayGain, 258_774);

    // Only starting values so far: nobody has earned or owes anything yet.
    const dayOne = computeCircleProgress([member(1, [900_000_000])], { quota: 240_000_000, daysInMonth: 31 });
    check('starting snapshot alone counts as zero earned', dayOne.members[0]!.total, 0);
    check('no game days elapsed yet', dayOne.daysElapsed, 0);
    check('days remaining before any data covers the whole month', dayOne.daysRemaining, 31);

    // A trainer who earned nothing for two days is still present and behind.
    const idle = computeCircleProgress([member(1, [500, 500, 500, 2_500])], { quota: 31_000, daysInMonth: 31 });
    const im = idle.members[0]!;
    check('zero-gain days still count toward quota', im.quotaDays, 3);
    check('idle member total', im.total, 2_000);
    check('idle member behind', im.behind, 1_000);

    // Joining on game day 3: starting snapshot at index 2, owes from day 3.
    const join = monthGains(raw([0, 0, 700, 1_700, 2_700]));
    check('mid-month joiner first owing day', join.firstDay, 3);
    check('mid-month joiner earned through day 4', join.gains[3], 2_000);

    // A missed sync carries forward instead of dropping to zero.
    const gap = monthGains(raw([100, 200, 0, 400]));
    check('missed sync is a zero-gain day', gap.gains.join(','), '100,100,300');
}

function main() {
    const series = ROWS.map(([name, total, , , , , gain], i) => buildSeries(name, i, total, gain));

    const progress = computeCircleProgress(series, {
        quota: MONTHLY_QUOTA,
        daysInMonth: DAYS_IN_MONTH,
    });

    check('days elapsed derived from data', progress.daysElapsed, DAYS_ELAPSED);
    check('days remaining includes today', progress.daysRemaining, 17);
    check('quota per day is floored', progress.quotaPerDay, 2_666_666);
    check('effective quota re-multiplies the floor', progress.effectiveQuota, 79_999_980);

    const byName = new Map(progress.members.map((m) => [m.trainerName, m]));

    let rowsOk = 0;
    for (const [name, total, expected, behind, avgPerDay, needPerDay, gain] of ROWS) {
        const m = byName.get(name);
        if (!m) {
            fail++;
            console.log(`FAIL  ${name} missing from output`);
            continue;
        }
        const ok =
            check(`${name} total`, m.total, total) &&
            check(`${name} expected`, m.expected, expected) &&
            check(`${name} behind`, m.behind, behind) &&
            check(`${name} avg/day`, m.avgPerDay, avgPerDay) &&
            check(`${name} need/day`, m.needPerDay, needPerDay) &&
            check(`${name} day-14 gain`, m.latestDayGain, gain);
        if (ok) rowsOk += 1;
    }

    console.log(`\n${rowsOk}/${ROWS.length} reference rows reproduced exactly.`);

    periodChecks();
    biweeklyChecks();
    membershipChecks();
    lifetimeChecks();
    console.log(`${pass} assertions passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
