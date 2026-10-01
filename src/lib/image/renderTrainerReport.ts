import { FOOTER_HEIGHT, MARGIN, THEME, beginCard, drawFooter, drawHeader, drawLabel, drawText, paceColor, placeColor } from './theme';
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

export async function renderTrainerReport(data: TrainerReportData): Promise<Buffer> {
    const headerBottom = 151;
    const tileHeight = 108;
    const tileGap = 16;
    const chartHeight = 300;
    const tilesTop = headerBottom + 24;
    const height = tilesTop + tileHeight * 2 + tileGap + 56 + chartHeight + FOOTER_HEIGHT + 24;

    const { canvas, ctx } = beginCard(WIDTH, height);

    const progressPct = data.goal > 0 ? (data.windowFans / data.goal) * 100 : 0;
    drawHeader(ctx, WIDTH, {
        eyebrow: `Trainer report  ·  ${data.circleName}`,
        title: data.trainerName,
        subtitle: `${data.windowLabel}  ·  goal ${formatCompactFans(data.goal)}  ·  quota ${formatCompactFans(data.quotaPerDay)} per day`,
        stats: [
            {
                label: 'Circle rank',
                value: data.rankInCircle !== null && data.circleSize ? `${data.rankInCircle}/${data.circleSize}` : '—',
                color: (data.rankInCircle !== null ? placeColor(data.rankInCircle) : null) ?? THEME.text,
            },
            {
                label: 'Goal',
                value: data.goal > 0 ? `${Math.floor(progressPct)}%` : '—',
                color: data.goal > 0 ? paceColor(progressPct, 80) : THEME.faint,
            },
        ],
    });

    // ── Headline figures, two rows ────────────────────────────────────────────
    const days = data.dailyGains.length;

    const rowOne: Tile[] = [
        { label: `${data.windowLabel} fans`, value: formatFans(data.windowFans), detail: formatCompactFans(data.windowFans), color: THEME.text },
        { label: 'Daily average', value: formatFans(data.dailyAverage), detail: `over ${days} day${days === 1 ? '' : 's'}`, color: THEME.text },
        {
            label: 'Goal progress',
            value: data.goal > 0 ? `${progressPct.toFixed(1)}%` : '—',
            ...(data.goal > 0 ? { detail: `of ${formatCompactFans(data.goal)}` } : {}),
            color: data.goal > 0 ? paceColor(progressPct, 80) : THEME.faint,
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
            color: data.aboveQuotaStreak > 0 ? THEME.accent : THEME.faint,
        },
        {
            label: 'Shame score',
            value: data.shameScore === null ? '—' : String(data.shameScore),
            detail: data.shameScore === null ? 'not reported' : 'from uma.moe',
            color: data.shameScore === null ? THEME.faint : THEME.text,
        },
    ];

    drawTileRow(ctx, rowOne, MARGIN, tilesTop, WIDTH - MARGIN * 2, tileHeight, tileGap);
    drawTileRow(ctx, rowTwo, MARGIN, tilesTop + tileHeight + tileGap, WIDTH - MARGIN * 2, tileHeight, tileGap);

    // ── Daily gains ───────────────────────────────────────────────────────────
    const chartTop = tilesTop + tileHeight * 2 + tileGap + 56;
    drawLabel(ctx, 'Daily fans gained', MARGIN, chartTop - 14, THEME.muted, 11);
    if (data.dailyGains.length === 0) {
        drawText(ctx, 'No daily fan data for this window yet.', MARGIN, chartTop + 40, { spec: '400 16px', color: THEME.faint });
    } else {
        drawChart(ctx, {
            x: MARGIN,
            y: chartTop,
            width: WIDTH - MARGIN * 2,
            height: chartHeight,
            labels: data.dailyGains.map((d) => d.label),
            series: [{ label: 'Fans gained', color: THEME.accent, values: data.dailyGains.map((d) => d.gain), fill: true, marker: 'circle' }],
            formatValue: formatCompactFans,
            pointLabels: data.dailyGains.length <= 16,
            legend: false,
            ...(data.quotaPerDay > 0 ? { referenceLines: [{ value: data.quotaPerDay, label: 'Daily quota', color: THEME.amber }] } : {}),
        });
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const updated = data.lastUpdated ? data.lastUpdated.toUTCString() : 'unknown';
    drawFooter(ctx, WIDTH, height, `Data source: uma.moe  ·  last updated ${updated}`);

    return canvas.encode('png');
}
