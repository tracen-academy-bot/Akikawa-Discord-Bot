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
import { computeCircleProgress, monthGains, periodWindow, type MemberSeries } from '../src/lib/fans/metrics';

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

    // Weekly, mid-month: 10M/day for 9 days against 70M/week. Week 2 is days
    // 8-14; two days in, the member has 20M of an expected 20M.
    const weekly = computeCircleProgress([steady(1, 10_000_000, 9)], { quota: 70_000_000, period: 'WEEK', daysInMonth: 30 });
    const wm = weekly.members[0]!;
    check('weekly window', `${weekly.windowStart}-${weekly.windowEnd}`, '8-14');
    check('weekly label', weekly.windowLabel, 'Week 2 · days 8–14');
    check('weekly per-day rate', weekly.quotaPerDay, 10_000_000);
    check('weekly goal for a full week', weekly.effectiveQuota, 70_000_000);
    check('weekly total counts only this week', wm.total, 20_000_000);
    check('weekly expected covers 2 days', wm.expected, 20_000_000);
    check('weekly on pace', wm.onPace, true);
    check('weekly days remaining in the week', weekly.daysRemaining, 6);
    check('weekly projection is to the end of the week', wm.projectedTotal, 70_000_000);
    check('weekly average is within the week', wm.avgPerDay, 10_000_000);

    // Short final week: day 30 of a 31-day month, 9M/day against 70M/week.
    // Days 29-31 owe 3/7 of 70M = 30M; two days in, 18M of an expected 20M.
    const short = computeCircleProgress([steady(1, 9_000_000, 30)], { quota: 70_000_000, period: 'WEEK', daysInMonth: 31 });
    const sm = short.members[0]!;
    check('short week window', `${short.windowStart}-${short.windowEnd}`, '29-31');
    check('short week goal scales by days', short.effectiveQuota, 30_000_000);
    check('short week total', sm.total, 18_000_000);
    check('short week behind', sm.behind, 2_000_000);
    check('short week days remaining', short.daysRemaining, 2);
    check('short week need/day spreads the shortfall', sm.needPerDay, 6_000_000);

    // A member who joins mid-week owes quota only from their first day.
    const joiner = computeCircleProgress([steady(1, 10_000_000, 12), steady(2, 10_000_000, 12, 10)], {
        quota: 70_000_000,
        period: 'WEEK',
        daysInMonth: 30,
    });
    const late = joiner.members.find((m) => m.viewerId === 2)!;
    check('mid-week joiner counts 3 days', late.quotaDays, 3);
    check('mid-week joiner expected', late.expected, 30_000_000);
    check('mid-week joiner total', late.total, 30_000_000);

    // Rank movement resets with the window: none on a week's first day.
    const firstDay = computeCircleProgress([steady(1, 10_000_000, 8), steady(2, 9_000_000, 8)], {
        quota: 70_000_000,
        period: 'WEEK',
        daysInMonth: 30,
    });
    check('no rank movement on a week\'s first day', firstDay.members[0]!.rankChange, null);

    // Daily: the window is the latest day; 7M earned on day 5 against 8M.
    const daily = computeCircleProgress([steady(1, 7_000_000, 5)], { quota: 8_000_000, period: 'DAY', daysInMonth: 30 });
    const dm = daily.members[0]!;
    check('daily label', daily.windowLabel, 'Day 5');
    check('daily goal is the quota', daily.effectiveQuota, 8_000_000);
    check('daily total is that day\'s gain', dm.total, 7_000_000);
    check('daily behind', dm.behind, 1_000_000);
    check('daily need is the rest of today', dm.needPerDay, 1_000_000);
    check('daily days remaining', daily.daysRemaining, 1);

    // MONTH stays the default, labelled with the month name when given.
    const month = computeCircleProgress([steady(1, 3_000_000, 5)], { quota: 90_000_000, daysInMonth: 30, monthName: 'October' });
    check('month is the default period', month.period, 'MONTH');
    check('month label is the month name', month.windowLabel, 'October');
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
    lifetimeChecks();
    console.log(`${pass} assertions passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
