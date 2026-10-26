/**
 * Renders the fan report in every palette and checks each palette's contrast.
 *
 *   npx ts-node --project tsconfig.scripts.json scripts/palettes.ts [outDir]
 *
 * Writes `fan-report-<palette>.png` (tall) and `fan-report-<palette>-wide.png`
 * for each palette into `outDir` (default:
 * the current directory) from made-up sample data, and prints the WCAG
 * contrast ratio of every text colour against the palette's background,
 * header panel and row stripe, whichever is worst.
 * Exits non-zero when a colour misses its floor: 4.5:1 for colours that carry
 * figures, 3:1 for `faint`, which is only for de-emphasised values.
 *
 * Needs no API key, and connects to no database, but `DATABASE_URL` must be
 * set (any value): the club-image loader imports the Prisma module, which
 * checks for it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeCircleProgress, type MemberSeries } from '../src/lib/fans/metrics';
import { renderFanReport } from '../src/lib/image/renderFanReport';
import { PALETTES, type Palette } from '../src/lib/image/theme';

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours, from 1 to 21. */
function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
}

/** Text colours in a palette and the worst contrast each has on `bg`, `panel` or `stripe`. */
function contrastRows(p: Palette): { key: string; color: string; ratio: number; floor: number }[] {
    const keys: [string, string, number][] = [
        ['text', p.text, 4.5],
        ['muted', p.muted, 4.5],
        ['faint', p.faint, 3],
        ['accent', p.accent, 4.5],
        ['target', p.target, 4.5],
        ['good', p.good, 4.5],
        ['warn', p.warn, 4.5],
        ['behind', p.behind, 4.5],
        ...p.place.map((c, i): [string, string, number] => [`place ${i + 1}`, c, 4.5]),
    ];
    const grounds = [p.bg, p.panel, p.stripe];
    return keys.map(([key, color, floor]) => ({ key, color, ratio: Math.min(...grounds.map((g) => contrast(color, g))), floor }));
}

/** Hue in degrees (0-360) and saturation (0-1) of a `#rrggbb` colour, as HSV. */
function hueSaturation(hex: string): { hue: number; saturation: number } {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let hue = 0;
    if (delta > 0) {
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
    }
    return { hue: (hue + 360) % 360, saturation: max === 0 ? 0 : delta / max };
}

/**
 * Problems telling the behind colours apart. A pale `warn` reads as plain
 * text (viinus, 2026-10-24: "a bit hard to differentiate"), so it must be
 * saturated, and its hue must sit clearly apart from `behind`.
 */
function distinctness(p: Palette): string[] {
    const warn = hueSaturation(p.warn);
    const behind = hueSaturation(p.behind);
    const gap = Math.min(Math.abs(warn.hue - behind.hue), 360 - Math.abs(warn.hue - behind.hue));
    const problems: string[] = [];
    if (warn.saturation < 0.6) problems.push(`warn ${p.warn} is pale (saturation ${warn.saturation.toFixed(2)} < 0.60), so it reads as text`);
    if (gap < 25) problems.push(`warn ${p.warn} and behind ${p.behind} are only ${gap.toFixed(0)} degrees of hue apart`);
    return problems;
}

/** CIE L*a*b* of a `#rrggbb` colour (D65). */
function toLab(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    const linear = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(linear) as [number, number, number];
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 colour difference: about 2 is just noticeable, 35 is plainly different. */
function deltaE(a: string, b: string): number {
    const [p, q] = [toLab(a), toLab(b)];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Least colour difference allowed between any two of the top 3. */
const PLACE_DELTA_E = 35;

/**
 * Problems telling the top 3 apart (Fwoxie, 2026-10-26: "top 3 should have
 * different colors"). Gold and bronze drift together, especially once
 * darkened for a light palette, so every pair must differ by
 * `PLACE_DELTA_E`.
 */
function placeDistinctness(p: Palette): string[] {
    const problems: string[] = [];
    for (let i = 0; i < 3; i += 1) {
        for (let j = i + 1; j < 3; j += 1) {
            const d = deltaE(p.place[i]!, p.place[j]!);
            if (d < PLACE_DELTA_E) problems.push(`place ${i + 1} ${p.place[i]} and place ${j + 1} ${p.place[j]} differ by only ${d.toFixed(0)} (need ${PLACE_DELTA_E})`);
        }
    }
    return problems;
}

/**
 * A 29-member circle like Cosmos on 2026-10-24: a biweekly 42.5M quota, day
 * 23 finished, the second half (days 15-31) in progress. A spread of totals,
 * several behind, some rank changes, and long and Japanese names to test
 * truncation.
 */
function sampleSeries(): MemberSeries[] {
    const names = [
        'Tylina', 'Konan', 'Zanzi', 'UomiChihiro', 'ZackOC', 'chusquared', 'SKX', 'まこっちゃん', 'hoshino', 'Lora',
        'FrenchToast4779', 'vilhelm', 'xyloh', 'Starareo', 'JAUXK', 'Hiru', 'Vicarilex', 'Glueman', 'XUOR', 'Kai',
        'Cement', 'Ayden', 'くり', 'kord', 'ori☆', 'Nahlo', 'Praetorian', 'AVeryLongTrainerNameIndeed', 'Fuzzlekins',
    ];
    return names.map((trainerName, i) => {
        // From about 15.3M a day at the top down to about 2.5M at the bottom.
        const perDay = Math.round(15_300_000 * (1 - i / 28) ** 1.6 + 2_500_000 * (i / 28));
        const base = 1_000_000_000 + i;
        const dailyFans = [base];
        for (let d = 1; d <= 23; d += 1) {
            // A good last day for a few, so yesterday's ranks differ a bit.
            const burst = d === 23 && i % 7 === 3 ? 6_000_000 : 0;
            dailyFans.push(dailyFans[d - 1]! + perDay + burst);
        }
        return { viewerId: i + 1, trainerName, dailyFans, shameScore: null };
    });
}

async function main() {
    const outDir = process.argv[2] ?? '.';
    mkdirSync(outDir, { recursive: true });
    const progress = computeCircleProgress(sampleSeries(), {
        quota: 42_500_000,
        period: 'BIWEEKLY',
        daysInMonth: 31,
        monthName: 'October',
        currentDay: 24,
    });

    let failures = 0;
    for (const palette of Object.values(PALETTES)) {
        const meta = {
            // A real club, so the image and rank badge slots are filled.
            circleName: 'Cosmos',
            clubRank: 'A_PLUS' as const,
            monthlyRank: 194,
            memberCount: progress.members.length,
            dateLabel: 'October 24, 2026',
            // #194 sits in the A+ band (101-500); made-up points at its edges.
            rankBand: {
                rank: 194,
                points: progress.totalFans,
                tier: 'A+',
                above: { rank: 100, tier: 'S', points: Math.round(progress.totalFans * 1.12) },
                below: { rank: 500, tier: 'A+', points: Math.round(progress.totalFans * 0.71) },
            },
        };
        const file = join(outDir, `fan-report-${palette.id}.png`);
        writeFileSync(file, await renderFanReport(progress, meta, palette, 'tall'));
        writeFileSync(join(outDir, `fan-report-${palette.id}-wide.png`), await renderFanReport(progress, meta, palette, 'wide'));

        console.log(`\n${palette.label} (${palette.id}) -> ${file}\n  ${palette.origin}`);
        for (const row of contrastRows(palette)) {
            const ok = row.ratio >= row.floor;
            if (!ok) failures += 1;
            console.log(`  ${ok ? 'ok  ' : 'LOW '} ${row.key.padEnd(8)} ${row.color}  ${row.ratio.toFixed(2)}:1 (floor ${row.floor}:1)`);
        }
        for (const problem of [...distinctness(palette), ...placeDistinctness(palette)]) {
            failures += 1;
            console.log(`  SAME ${problem}`);
        }
    }
    console.log(failures === 0 ? '\nEvery colour meets its floor, and the behind colours and the top 3 are distinct.' : `\n${failures} problem(s).`);
    process.exitCode = failures === 0 ? 0 : 1;
}

void main();
