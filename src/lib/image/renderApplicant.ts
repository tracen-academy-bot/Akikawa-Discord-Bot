import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { THEME, drawLabel, drawRule, drawText } from './theme';
import { drawChart } from './chart';
import { drawTileRow, type Tile } from './tiles';
import { formatCompactFans } from '../fans/metrics';
import type { DayGain, MonthSummary, MonthsAverage, WindowAverage } from '../applications/history';

/**
 * An applicant's card: who they are, their pace over three spans, the last
 * 30 days as a line, and the last months as bars.
 *
 * Both views plot fans per day, so the line and the bars read on the same
 * scale as each other and as a club's daily quota. The 30-day average is
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
    const active = `${recent.activeDays} of ${recorded} recorded days with fans`;
    return recent.estimatedDays > 0 ? `${active}, ${recent.estimatedDays} estimated` : active;
}

/** Detail line for a months average: "3 of 3 months", "1 of 6 months". */
function monthsDetail(avg: MonthsAverage): string {
    if (avg.perDay === null) return 'no finished months on record';
    return `${avg.months} of ${avg.of} months on record`;
}

/** Bars of fans per day, one per month, oldest on the left. */
function drawMonthBars(ctx: SKRSContext2D, months: MonthSummary[], x: number, y: number, w: number, h: number) {
    const ordered = [...months].reverse();
    const peak = Math.max(1, ...ordered.map((m) => m.perDay ?? 0));
    const labelBand = 44;
    const valueBand = 22;
    const plotH = h - labelBand - valueBand;
    const slot = w / ordered.length;
    const barW = Math.min(90, slot * 0.6);
    const baseY = y + valueBand + plotH;

    drawRule(ctx, x, baseY, w, THEME.line, 1);
    ordered.forEach((m, i) => {
        const cx = x + slot * i + slot / 2;
        const label = `${MONTHS[m.month - 1]} ${String(m.year).slice(2)}`;
        drawText(ctx, label, cx, baseY + 20, { spec: '500 13px', color: THEME.muted, align: 'center' });
        const note = m.inProgress ? 'so far' : m.firstOnRecord ? 'first on record' : '';
        if (note) drawText(ctx, note, cx, baseY + 37, { spec: '400 11px', color: THEME.faint, align: 'center' });

        if (m.perDay === null) {
            drawText(ctx, 'no data', cx, baseY - 8, { spec: '400 12px', color: THEME.faint, align: 'center' });
            return;
        }
        const barH = Math.max(2, (m.perDay / peak) * plotH);
        // The month in progress and a possibly partial first month are dimmed:
        // their per-day figure is less settled than a full month's.
        ctx.fillStyle = m.inProgress || m.firstOnRecord ? THEME.goldDim : THEME.gold;
        ctx.fillRect(cx - barW / 2, baseY - barH, barW, barH);
        drawText(ctx, formatCompactFans(Math.round(m.perDay)), cx, baseY - barH - 7, { spec: '600 13px', color: THEME.text, align: 'center' });
    });
}

export async function renderApplicantCard(data: ApplicantCardData): Promise<Buffer> {
    const headerHeight = 112;
    const tileHeight = 104;
    const chartHeight = 290;
    const barsHeight = 230;
    const sectionGap = 56;
    const height = headerHeight + 12 + tileHeight + sectionGap + chartHeight + 34 + sectionGap + barsHeight + 50;

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
    drawLabel(ctx, 'Fans per day, by month', MARGIN, top - 14, THEME.muted, 12);
    drawMonthBars(ctx, data.months, MARGIN, top, WIDTH - MARGIN * 2, barsHeight);

    // ── Footer ────────────────────────────────────────────────────────────────
    const updated = data.lastUpdated ? data.lastUpdated.toUTCString() : 'unknown';
    drawText(ctx, `Per calendar day, not per active day.  Data source: uma.moe  ·  last updated ${updated}`, MARGIN, height - 20, {
        spec: '400 12px',
        color: THEME.faint,
    });

    return canvas.encode('png');
}
