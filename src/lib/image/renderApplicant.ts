import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { THEME, drawLabel, drawRule, drawText } from './theme';
import { drawChart } from './chart';
import { drawTileRow, type Tile } from './tiles';
import { formatCompactFans, formatFans } from '../fans/metrics';
import { fit } from './cards';
import { font } from './fonts';
import type { DayGain, MonthSummary, MonthsAverage, WindowAverage } from '../applications/history';

/**
 * An applicant's card: who they are, their pace over three spans, the last
 * 30 days as a line, and the last months as a table of totals with the
 * rank of the club they were in each month.
 *
 * The 30-day average is
 * drawn across the line as a guide, so a good week is read against the
 * trainer's own norm.
 */

const WIDTH = 1200;
const MARGIN = 40;

/** Short month names, for bar labels. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface ApplicantCardData {
    trainerName: string;
    viewerId: string;
    currentCircle: string | null;
    /** The post's forum tags, e.g. ["S+", "S"]. */
    tags: string[];
    recent: WindowAverage;
    threeMonths: MonthsAverage;
    sixMonths: MonthsAverage;
    /** Newest first, as `monthSummaries` returns them. */
    months: MonthSummary[];
    lastUpdated: Date | null;
}

/** "1.2M/day", or a dash. */
function perDay(value: number | null): string {
    return value === null ? '—' : `${formatCompactFans(Math.round(value))}/day`;
}

/** "Oct 3", for a day of the series. */
function dayLabel(d: DayGain): string {
    return `${MONTHS[d.month - 1]} ${d.day}`;
}

/**
 * Runs of consecutive estimated days, as "Oct 1–21". Days in a run are
 * consecutive in the series, which has no holes.
 */
export function estimatedRuns(days: DayGain[]): string[] {
    const runs: string[] = [];
    let start: DayGain | null = null;
    let prev: DayGain | null = null;
    for (const d of [...days, null]) {
        if (d?.estimated) {
            if (!start) start = d;
            prev = d;
            continue;
        }
        if (start && prev) runs.push(start === prev ? dayLabel(start) : `${dayLabel(start)}–${dayLabel(prev)}`);
        start = null;
        prev = null;
    }
    return runs;
}

/** Detail line for the 30-day tile: active days, and estimated days if any. */
function recentDetail(recent: WindowAverage): string {
    if (recent.days === 0) return 'no daily data on uma.moe';
    const recorded = recent.days - recent.estimatedDays;
    // Kept short: the tile is about 33 characters wide at this size.
    if (recent.estimatedDays > 0) return `${recent.activeDays}/${recorded} days with fans, ${recent.estimatedDays} est.`;
    return `${recent.activeDays} of ${recorded} days with fans`;
}

/** Detail line for a months average: "3 of 3 months", "1 of 6 months". */
function monthsDetail(avg: MonthsAverage): string {
    if (avg.perDay === null) return 'no finished months on record';
    return `${avg.months} of ${avg.of} months on record`;
}

/** Club rank tiers, lowest first, as uma.moe names them. */
export const CLUB_RANKS = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+', 'SS'] as const;

/** Badge file stem for a rank name: "B+" is `B_PLUS.png`, "SS" is `SS.png`. */
export function rankFileStem(rank: string): string {
    return rank.trim().toUpperCase().replace('+', '_PLUS');
}

/** Colour of a rank's text badge, when it has no picture yet. */
function rankColor(rank: string): string {
    const i = CLUB_RANKS.indexOf(rank as (typeof CLUB_RANKS)[number]);
    if (i >= 8) return '#f4b13f';
    if (i >= 6) return '#56d364';
    if (i >= 4) return '#79c0ff';
    if (i >= 2) return '#c9a0dc';
    return THEME.muted;
}

const rankImages = new Map<string, Image | null>();

/** A rank's badge picture from `assets/ranks`, or null when there is none yet. */
async function rankImage(rank: string): Promise<Image | null> {
    const stem = rankFileStem(rank);
    if (rankImages.has(stem)) return rankImages.get(stem)!;
    const file = path.join(__dirname, '..', '..', 'assets', 'ranks', `${stem}.png`);
    const image = fs.existsSync(file) ? await loadImage(file).catch(() => null) : null;
    rankImages.set(stem, image);
    return image;
}

/** A club rank flag: its badge picture, or the rank in a coloured outline. */
async function drawRankFlag(ctx: SKRSContext2D, rank: string, x: number, cy: number) {
    const image = await rankImage(rank);
    if (image) {
        // The pictures are 310x360; drawn 26 tall.
        const h = 26;
        const w = (image.width / image.height) * h;
        ctx.drawImage(image, x, cy - h / 2, w, h);
        drawText(ctx, rank, x + w + 8, cy + 5, { spec: '700 15px', color: rankColor(rank) });
        return;
    }
    const color = rankColor(rank);
    ctx.font = font('700 14px');
    const w = Math.max(30, ctx.measureText(rank).width + 16);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, cy - 11.5, w, 23);
    drawText(ctx, rank, x + w / 2, cy + 5, { spec: '700 14px', color, align: 'center' });
}

/** Height of the month table for `rows` months. */
function monthTableHeight(rows: number): number {
    return 34 + rows * 38;
}

/**
 * A row per month, newest first: the club the trainer was in, that club's
 * rank tier that month, fans gained, and the trainer's place in the month's
 * fan ranking. Plain totals, no per-day average: a month's per-day figure
 * depends on how many of its days the trainer was tracked, which uma.moe
 * does not give.
 */
async function drawMonthTable(ctx: SKRSContext2D, months: MonthSummary[], x: number, y: number, w: number) {
    const cols = { month: x + 14, club: x + 190, rank: x + 480, gained: x + w - 260, fanRank: x + w - 14 };
    drawLabel(ctx, 'Month', cols.month, y + 14, THEME.faint, 11);
    drawLabel(ctx, 'Club', cols.club, y + 14, THEME.faint, 11);
    drawLabel(ctx, 'Club rank', cols.rank, y + 14, THEME.faint, 11);
    drawLabel(ctx, 'Fans gained', cols.gained, y + 14, THEME.faint, 11, 'right');
    drawLabel(ctx, 'Fan ranking', cols.fanRank, y + 14, THEME.faint, 11, 'right');
    drawRule(ctx, x, y + 24, w, THEME.line, 1);

    for (const [i, m] of months.entries()) {
        const top = y + 34 + i * 38;
        const cy = top + 19;
        if (i % 2 === 0) {
            ctx.fillStyle = THEME.bgRaised;
            ctx.fillRect(x, top, w, 38);
        }
        const monthW = drawText(ctx, `${MONTHS[m.month - 1]} ${m.year}`, cols.month, cy + 5, { spec: '600 15px', color: THEME.text });
        const note = m.inProgress ? 'so far' : m.firstOnRecord ? 'first on record' : '';
        if (note) drawText(ctx, note, cols.month + monthW + 10, cy + 5, { spec: '400 12px', color: THEME.faint });
        if (m.gain === null) {
            drawText(ctx, 'no record on uma.moe', cols.club, cy + 5, { spec: '400 14px', color: THEME.faint });
            continue;
        }
        drawText(ctx, fit(ctx, m.clubName ?? '—', cols.rank - cols.club - 20, '400 15px'), cols.club, cy + 5, { spec: '400 15px', color: m.clubName ? THEME.text : THEME.faint });
        if (m.clubRank) await drawRankFlag(ctx, m.clubRank, cols.rank, cy);
        else drawText(ctx, '—', cols.rank, cy + 5, { spec: '400 15px', color: THEME.faint });
        drawText(ctx, formatFans(m.gain), cols.gained, cy + 5, { spec: '600 15px', color: THEME.text, align: 'right' });
        drawText(ctx, m.fanRank ? `#${m.fanRank.toLocaleString('en-US')}` : '—', cols.fanRank, cy + 5, {
            spec: '400 15px',
            color: m.fanRank ? THEME.muted : THEME.faint,
            align: 'right',
        });
    }
}

export async function renderApplicantCard(data: ApplicantCardData): Promise<Buffer> {
    const headerHeight = 112;
    const tileHeight = 104;
    const chartHeight = 290;
    const tableHeight = monthTableHeight(data.months.length);
    const sectionGap = 56;
    const height = headerHeight + 12 + tileHeight + sectionGap + chartHeight + 34 + sectionGap + tableHeight + 50;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, WIDTH, height);

    // ── Header ────────────────────────────────────────────────────────────────
    drawLabel(ctx, 'Club application', MARGIN, 40, THEME.gold, 12);
    drawText(ctx, data.trainerName, MARGIN, 78, { spec: '500 30px', color: THEME.text });
    drawText(ctx, `ID ${data.viewerId}  ·  ${data.currentCircle ? `now in ${data.currentCircle}` : 'not in a club'}`, MARGIN, 100, {
        spec: '400 14px',
        color: THEME.muted,
    });
    drawLabel(ctx, 'Looking for', WIDTH - MARGIN, 40, THEME.muted, 12, 'right');
    drawText(ctx, data.tags.length > 0 ? data.tags.join('  ·  ') : 'no tags', WIDTH - MARGIN, 78, {
        spec: '600 22px',
        color: data.tags.length > 0 ? THEME.gold : THEME.faint,
        align: 'right',
    });
    drawRule(ctx, MARGIN, headerHeight - 4, WIDTH - MARGIN * 2, THEME.gold, 1.5);

    // ── Pace ──────────────────────────────────────────────────────────────────
    const best = data.recent.window.reduce<DayGain | null>((b, d) => (!d.estimated && (!b || d.gain > b.gain) ? d : b), null);
    const tiles: Tile[] = [
        {
            label: `Last ${data.recent.days || 30} days`,
            value: perDay(data.recent.perDay),
            detail: recentDetail(data.recent),
            color: data.recent.perDay === null ? THEME.faint : THEME.text,
        },
        { label: 'Last 3 months', value: perDay(data.threeMonths.perDay), detail: monthsDetail(data.threeMonths), color: data.threeMonths.perDay === null ? THEME.faint : THEME.text },
        { label: 'Last 6 months', value: perDay(data.sixMonths.perDay), detail: monthsDetail(data.sixMonths), color: data.sixMonths.perDay === null ? THEME.faint : THEME.text },
        {
            label: 'Best day (30d)',
            value: best ? formatCompactFans(Math.round(best.gain)) : '—',
            ...(best ? { detail: dayLabel(best) } : {}),
            color: best ? THEME.text : THEME.faint,
        },
    ];
    drawTileRow(ctx, tiles, MARGIN, headerHeight + 12, WIDTH - MARGIN * 2, tileHeight);

    // ── Last 30 days ──────────────────────────────────────────────────────────
    let top = headerHeight + 12 + tileHeight + sectionGap;
    drawLabel(ctx, 'Fans per day, last 30 days', MARGIN, top - 14, THEME.muted, 12);
    const window = data.recent.window;
    if (window.length === 0) {
        drawText(ctx, 'uma.moe has no daily data for this trainer: they are not in a circle it tracks.', MARGIN, top + 40, { spec: '400 16px', color: THEME.faint });
    } else {
        drawChart(ctx, {
            x: MARGIN,
            y: top,
            width: WIDTH - MARGIN * 2,
            height: chartHeight,
            labels: window.map(dayLabel),
            series: [{ label: 'Fans gained', color: THEME.gold, values: window.map((d) => Math.round(d.gain)), fill: true, marker: window.length <= 31 ? 'circle' : 'none' }],
            formatValue: formatCompactFans,
            legend: true,
            ...(data.recent.perDay !== null ? { referenceLines: [{ value: Math.round(data.recent.perDay), label: '30-day average', color: THEME.muted }] } : {}),
        });
        const runs = estimatedRuns(window);
        if (runs.length > 0) {
            drawText(ctx, `Estimated (no uma.moe snapshot; the rise across the gap is spread evenly): ${runs.join(', ')}`, MARGIN, top + chartHeight + 22, {
                spec: '400 12px',
                color: THEME.faint,
            });
        }
    }

    // ── Months ────────────────────────────────────────────────────────────────
    top += chartHeight + 34 + sectionGap;
    drawLabel(ctx, 'By month', MARGIN, top - 14, THEME.muted, 12);
    await drawMonthTable(ctx, data.months, MARGIN, top, WIDTH - MARGIN * 2);

    // ── Footer ────────────────────────────────────────────────────────────────
    const updated = data.lastUpdated ? data.lastUpdated.toUTCString() : 'unknown';
    drawText(ctx, `Per calendar day, not per active day.  Data source: uma.moe  ·  last updated ${updated}`, MARGIN, height - 20, {
        spec: '400 12px',
        color: THEME.faint,
    });

    return canvas.encode('png');
}
