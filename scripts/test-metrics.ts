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
import { computeCircleProgress, type MemberSeries } from '../src/lib/fans/metrics';

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
function buildSeries(name: string, index: number, total: number, day14Gain: number): MemberSeries {
    const dailyFans = new Array<number>(31).fill(0);
    const day13 = total - day14Gain;
    for (let day = 1; day <= 13; day += 1) {
        dailyFans[day - 1] = Math.round((day13 * day) / 13);
    }
    dailyFans[13] = total;
    return { viewerId: index + 1, trainerName: name, dailyFans, shameScore: null };
}

function main() {
    const series = ROWS.map(([name, total, , , , , gain], i) => buildSeries(name, i, total, gain));

    const progress = computeCircleProgress(series, {
        monthlyQuota: MONTHLY_QUOTA,
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
    console.log(`${pass} assertions passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
