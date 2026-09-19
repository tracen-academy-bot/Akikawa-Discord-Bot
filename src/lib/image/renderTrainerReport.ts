import { createCanvas } from '@napi-rs/canvas';
import { THEME, drawLabel, drawRule, drawText } from './theme';
import { drawChart } from './chart';
import { drawTileRow, type Tile } from './tiles';
import { formatCompactFans, formatFans } from '../fans/metrics';

/**
 * A single trainer's fan report: headline figures over a chart of daily gains.
 *
 * The chart plots per-day *gains*, not cumulative totals: a cumulative line
 * only ever slopes upward and hides the thing that matters, whether output is
 * holding up. The daily quota is drawn as a guide line so every bar's height
 * is read against the target, not against the axis.
 */

const WIDTH = 1200;
const MARGIN = 40;

export interface TrainerReportData {
    trainerName: string;
    circleName: string;
    /** Per-day gains for the plotted window, oldest first. */
    dailyGains: { label: string; gain: number }[];
    windowFans: number;
    dailyAverage: number;
    /** Fans owed across exactly the plotted days. */
    goal: number;
    shameScore: number | null;
    windowLabel: string;
    lastUpdated: Date | null;
    /** Placement in the circle by cumulative total, when known. */
    rankInCircle: number | null;
    circleSize: number | null;
    /** Highest single-day gain this month. */
    bestDay: { label: string; gain: number } | null;
    /** Consecutive latest days at or above the daily quota. */
    aboveQuotaStreak: number;
    quotaPerDay: number;
}

/** Green at or above target, gold within reach, red short. */
function progressColor(pct: number): string {
    if (pct >= 100) return THEME.green;
    if (pct >= 80) return THEME.gold;
    return THEME.red;
}

export async function renderTrainerReport(data: TrainerReportData): Promise<Buffer> {
    const headerHeight = 112;
    const tileHeight = 104;
    const tileGap = 14;
    const chartHeight = 300;
    const height = headerHeight + tileHeight * 2 + tileGap + chartHeight + 132;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, WIDTH, height);

    // ── Header ────────────────────────────────────────────────────────────────
    drawLabel(ctx, 'Trainer report', MARGIN, 40, THEME.gold, 12);
    drawText(ctx, data.trainerName, MARGIN, 76, { spec: '500 30px', color: THEME.text });

    const placement =
        data.rankInCircle !== null && data.circleSize
            ? `rank ${data.rankInCircle} of ${data.circleSize} · top ${Math.max(1, Math.round((data.rankInCircle / data.circleSize) * 100))}%`
            : 'unranked';
    drawLabel(ctx, `${data.circleName} · ${placement}`, WIDTH - MARGIN, 40, THEME.muted, 12, 'right');
    drawText(ctx, `${data.windowLabel} · goal ${formatCompactFans(data.goal)} · quota ${formatCompactFans(data.quotaPerDay)}/day`, WIDTH - MARGIN, 76, {
        spec: '400 14px',
        color: THEME.gold,
        align: 'right',
    });
    drawRule(ctx, MARGIN, headerHeight - 8, WIDTH - MARGIN * 2, THEME.gold, 1.5);

    // ── Headline figures, two rows ────────────────────────────────────────────
    const progressPct = data.goal > 0 ? (data.windowFans / data.goal) * 100 : 0;
    const days = data.dailyGains.length;

    const rowOne: Tile[] = [
        { label: `${data.windowLabel} fans`, value: formatFans(data.windowFans), detail: formatCompactFans(data.windowFans), color: THEME.text },
        { label: 'Daily average', value: formatFans(data.dailyAverage), detail: `over ${days} day${days === 1 ? '' : 's'}`, color: THEME.text },
        {
            label: 'Goal progress',
            value: data.goal > 0 ? `${progressPct.toFixed(1)}%` : '—',
            ...(data.goal > 0 ? { detail: `of ${formatCompactFans(data.goal)}` } : {}),
            color: data.goal > 0 ? progressColor(progressPct) : THEME.faint,
        },
    ];
    const rowTwo: Tile[] = [
        {
            label: 'Best day',
            value: data.bestDay ? formatFans(data.bestDay.gain) : '—',
            ...(data.bestDay ? { detail: data.bestDay.label } : {}),
            color: data.bestDay ? THEME.text : THEME.faint,
        },
        {
            label: 'Above quota',
            value: `${data.aboveQuotaStreak}d`,
            detail: data.aboveQuotaStreak > 0 ? 'consecutive days' : 'not currently',
            color: data.aboveQuotaStreak > 0 ? THEME.gold : THEME.faint,
        },
        {
            label: 'Shame score',
            value: data.shameScore === null ? '—' : String(data.shameScore),
            detail: data.shameScore === null ? 'not reported' : 'from uma.moe',
            color: data.shameScore === null ? THEME.faint : THEME.text,
        },
    ];

    drawTileRow(ctx, rowOne, MARGIN, headerHeight + 12, WIDTH - MARGIN * 2, tileHeight);
    drawTileRow(ctx, rowTwo, MARGIN, headerHeight + 12 + tileHeight + tileGap, WIDTH - MARGIN * 2, tileHeight);

    // ── Daily gains ───────────────────────────────────────────────────────────
    const chartTop = headerHeight + 12 + tileHeight * 2 + tileGap + 44;
    if (data.dailyGains.length === 0) {
        drawText(ctx, 'No daily fan data for this window yet.', MARGIN, chartTop + 40, { spec: '400 16px', color: THEME.faint });
    } else {
        drawChart(ctx, {
            x: MARGIN,
            y: chartTop,
            width: WIDTH - MARGIN * 2,
            height: chartHeight,
            labels: data.dailyGains.map((d) => d.label),
            series: [{ label: 'Fans gained', color: THEME.gold, values: data.dailyGains.map((d) => d.gain), fill: true, marker: 'circle' }],
            formatValue: formatCompactFans,
            pointLabels: data.dailyGains.length <= 16,
            legend: true,
            ...(data.quotaPerDay > 0 ? { referenceLines: [{ value: data.quotaPerDay, label: 'Daily quota', color: THEME.muted }] } : {}),
        });
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const updated = data.lastUpdated ? data.lastUpdated.toUTCString() : 'unknown';
    drawText(ctx, `Data source: uma.moe  ·  last updated ${updated}`, MARGIN, height - 22, { spec: '400 12px', color: THEME.faint });

    return canvas.encode('png');
}
