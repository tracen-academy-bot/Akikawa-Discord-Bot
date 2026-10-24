/**
 * Renders the fan report in every palette and checks each palette's contrast.
 *
 *   npx ts-node --project tsconfig.scripts.json scripts/palettes.ts [outDir]
 *
 * Writes `fan-report-<palette>.png` for each palette into `outDir` (default:
 * the current directory) from made-up sample data, and prints the WCAG
 * contrast ratio of every text colour against the palette's background.
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

/** Text colours in a palette and the contrast each must reach on `bg`. */
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
    return keys.map(([key, color, floor]) => ({ key, color, ratio: contrast(color, p.bg), floor }));
}

/**
 * A 12-member circle on day 23 of 31 with a 247M monthly quota: a spread of
 * totals, a few behind, one rank change, and a long name to test truncation.
 */
function sampleSeries(): MemberSeries[] {
    const names = ['Tylina', 'Konan', 'Zanzi', 'UomiChihiro', 'ZackOC', 'chusquared', 'FrenchToast4779', 'まこっちゃん', 'Starareo', 'JAUXK', 'Hiru', 'Fuzzlekins'];
    const perDay = [15.2, 13.6, 11.1, 9.4, 8.9, 8.4, 8.1, 7.99, 7.9, 7.4, 6.6, 3.9].map((m) => m * 1_000_000);
    return names.map((trainerName, i) => {
        const base = 1_000_000_000 + i;
        const dailyFans = [base];
        for (let d = 1; d <= 23; d += 1) {
            // A little day-to-day wobble so yesterday's ranks differ a bit.
            const wobble = d === 23 && i === 8 ? 1_500_000 : 0;
            dailyFans.push(dailyFans[d - 1]! + Math.round(perDay[i]!) + wobble);
        }
        return { viewerId: i + 1, trainerName, dailyFans, shameScore: null };
    });
}

async function main() {
    const outDir = process.argv[2] ?? '.';
    mkdirSync(outDir, { recursive: true });
    const progress = computeCircleProgress(sampleSeries(), {
        quota: 247_000_000,
        daysInMonth: 31,
        monthName: 'October',
        currentDay: 24,
    });

    let failures = 0;
    for (const palette of Object.values(PALETTES)) {
        const png = await renderFanReport(progress, {
            circleName: `Sample · ${palette.label}`,
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
