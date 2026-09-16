import { createCanvas } from '@napi-rs/canvas';
import { roundRect } from './canvasUtils';
import { font } from './fonts';
import { drawChart } from './chart';
import { drawTileRow, type Tile } from './tiles';
import { formatCompactFans, formatFans } from '../fans/metrics';

/**
 * Renders a single trainer's fan report: headline figures over a chart of
 * their daily gains.
 *
 * The chart plots per-day *gains*, not the cumulative totals the API returns.
 * A cumulative line only ever slopes upward and hides the thing that matters —
 * whether someone's daily output is holding up or falling off.
 */

const WIDTH = 1200;
const TEXT_PRIMARY = '#ffffff';
const TEXT_MUTED = '#9ba3b4';
const TEXT_FAINT = '#6b7280';
const HAIRLINE = 'rgba(255, 255, 255, 0.08)';
const ACCENT = '#f4655f';
const GOOD = '#7ee787';
const INFO = '#79c0ff';

/** Everything the report needs, already derived. */
export interface TrainerReportData {
    trainerName: string;
    circleName: string;
    /** Per-day gains for the plotted window, oldest first. */
    dailyGains: { label: string; gain: number }[];
    /** Fans gained across the whole window. */
    windowFans: number;
    /** Mean gain per day across the window. */
    dailyAverage: number;
    /** Fans the trainer was expected to earn over this window. */
    goal: number;
    /** uma.moe suspicious-activity score, if the API supplied one. */
    shameScore: number | null;
    /** Window heading, e.g. "Week 2" or "Last 14 days". */
    windowLabel: string;
    /** `last_updated` from uma.moe, shown so stale data is obvious. */
    lastUpdated: Date | null;
}

/** Colour for goal progress: green at or above target, amber close, red short. */
function progressColor(pct: number): string {
    if (pct >= 100) return GOOD;
    if (pct >= 80) return '#e0a33e';
    return ACCENT;
}

export async function renderTrainerReport(data: TrainerReportData): Promise<Buffer> {
    const headerHeight = 92;
    const tileHeight = 108;
    const chartHeight = 300;
    const height = headerHeight + tileHeight + chartHeight + 150;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, WIDTH, height);
    bg.addColorStop(0, '#191a24');
    bg.addColorStop(1, '#101119');
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, WIDTH, height, 20);
    ctx.fill();

    // ── Header ────────────────────────────────────────────────────────────────
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = font('bold 32px');
    ctx.fillText(`Trainer Report — ${data.trainerName}`, 40, 50);

    ctx.font = font('15px');
    ctx.fillStyle = TEXT_MUTED;
    ctx.fillText(
        `${data.windowLabel}  •  ${data.circleName}  •  Goal: ${formatCompactFans(data.goal)}`,
        40,
        76,
    );

    ctx.strokeStyle = HAIRLINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, headerHeight);
    ctx.lineTo(WIDTH - 40, headerHeight);
    ctx.stroke();

    // ── Headline figures ──────────────────────────────────────────────────────
    // Guard against a zero goal, which would make the percentage infinite.
    const progressPct = data.goal > 0 ? (data.windowFans / data.goal) * 100 : 0;

    const tiles: Tile[] = [
        {
            label: `${data.windowLabel} Fans`,
            value: formatFans(data.windowFans),
            detail: formatCompactFans(data.windowFans),
            color: TEXT_PRIMARY,
        },
        {
            label: 'Daily Average',
            value: formatFans(data.dailyAverage),
            detail: `over ${data.dailyGains.length} day${data.dailyGains.length === 1 ? '' : 's'}`,
            color: INFO,
        },
        {
            label: 'Goal Progress',
            value: data.goal > 0 ? `${progressPct.toFixed(2)}%` : 'No goal set',
            // `exactOptionalPropertyTypes` forbids assigning undefined to an
            // optional property, so the key is omitted rather than nulled.
            ...(data.goal > 0 ? { detail: `of ${formatCompactFans(data.goal)}` } : {}),
            color: data.goal > 0 ? progressColor(progressPct) : TEXT_FAINT,
        },
        {
            label: 'Shame Score',
            value: data.shameScore === null ? '\u2014' : String(data.shameScore),
            detail: data.shameScore === null ? 'not reported' : 'from uma.moe',
            color: data.shameScore === null ? TEXT_FAINT : TEXT_PRIMARY,
        },
    ];

    drawTileRow(ctx, tiles, 40, headerHeight + 20, WIDTH - 80, tileHeight);

    // ── Daily gains ───────────────────────────────────────────────────────────
    const chartTop = headerHeight + tileHeight + 52;

    if (data.dailyGains.length === 0) {
        ctx.font = font('17px');
        ctx.fillStyle = TEXT_FAINT;
        ctx.textAlign = 'left';
        ctx.fillText('No daily fan data for this window yet.', 40, chartTop + 40);
    } else {
        drawChart(ctx, {
            x: 40,
            y: chartTop,
            width: WIDTH - 80,
            height: chartHeight,
            labels: data.dailyGains.map((d) => d.label),
            series: [
                {
                    label: 'Fans',
                    color: ACCENT,
                    values: data.dailyGains.map((d) => d.gain),
                    fill: true,
                    marker: 'circle',
                },
            ],
            formatValue: formatCompactFans,
            // Legible here because there is only one series.
            pointLabels: data.dailyGains.length <= 16,
            legend: true,
        });
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    ctx.textAlign = 'left';
    ctx.font = font('12px');
    ctx.fillStyle = '#555b6e';
    const updated = data.lastUpdated ? data.lastUpdated.toUTCString() : 'unknown';
    ctx.fillText(`Data source: uma.moe  |  Last data updated: ${updated}`, 40, height - 22);

    return canvas.encode('png');
}
