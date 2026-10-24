/**
 * Renders the fan report in every palette and checks each palette's contrast.
 *
 *   npx ts-node --project tsconfig.scripts.json scripts/palettes.ts [outDir]
 *
 * Writes `fan-report-<palette>.png` for each palette into `outDir` (default:
 * the current directory) from made-up sample data, and prints the WCAG
 * contrast ratio of every text colour against the palette's background,
 * header panel and row stripe, whichever is worst.
 * Exits non-zero when a colour misses its floor: 4.5:1 for colours that carry
 * figures, 3:1 for `faint`, which is only for de-emphasised values.
 *
 * Needs no database or API key.
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
        ['behind', p.behind, 4.5],
        ...p.place.map((c, i): [string, string, number] => [`place ${i + 1}`, c, 4.5]),
    ];
    const grounds = [p.bg, p.panel, p.stripe];
    return keys.map(([key, color, floor]) => ({ key, color, ratio: Math.min(...grounds.map((g) => contrast(color, g))), floor }));
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
        const png = await renderFanReport(progress, {
            circleName: palette.label,
            monthlyRank: 194,
            memberCount: progress.members.length,
            dateLabel: 'October 24, 2026',
        }, palette);
        const file = join(outDir, `fan-report-${palette.id}.png`);
        writeFileSync(file, png);

        console.log(`\n${palette.label} (${palette.id}) -> ${file}\n  ${palette.origin}`);
        for (const row of contrastRows(palette)) {
            const ok = row.ratio >= row.floor;
            if (!ok) failures += 1;
            console.log(`  ${ok ? 'ok  ' : 'LOW '} ${row.key.padEnd(8)} ${row.color}  ${row.ratio.toFixed(2)}:1 (floor ${row.floor}:1)`);
        }
    }
    console.log(failures === 0 ? '\nEvery colour meets its floor.' : `\n${failures} colour(s) below their floor.`);
    process.exitCode = failures === 0 ? 0 : 1;
}

void main();
