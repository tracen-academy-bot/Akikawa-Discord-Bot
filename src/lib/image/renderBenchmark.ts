import { createCanvas } from '@napi-rs/canvas';
import { roundRect } from './canvasUtils';
import { font } from './fonts';
import { drawChart, type ChartSeries } from './chart';
import { formatCompactFans, formatFans } from '../fans/metrics';

/**
 * Renders the competitive benchmark: what it currently takes to sit inside the
 * top 10, 30 and 100 circles, measured in fans per member per day.
 *
 * Normalising by member count and by day is what makes circles of different
 * sizes comparable, and is the figure a club actually sets its quota against.
 */

const WIDTH = 1200;
const ROW_HEIGHT = 40;

const TEXT_PRIMARY = '#e6e6e6';
const TEXT_MUTED = '#9ba3b4';
const TEXT_FAINT = '#6b7280';
const HAIRLINE = 'rgba(255, 255, 255, 0.08)';

/** Per-tier styling. Line style varies as well as colour, for colourblind legibility. */
const TIER_STYLE: Record<number, { color: string; style: 'solid' | 'dashed' | 'dotted'; marker: 'circle' | 'triangle' | 'diamond' }> = {
    10: { color: '#f4655f', style: 'solid', marker: 'circle' },
    30: { color: '#e8c547', style: 'dashed', marker: 'triangle' },
    100: { color: '#79c0ff', style: 'dotted', marker: 'diamond' },
};

/** Current cutoff figures for one tier. */
export interface BenchmarkTier {
    tier: number;
    /** Fans/member/day of the circle sitting exactly on the cutoff. */
    entry: number;
    /** Mean fans/member/day across every circle above the cutoff. */
    average: number;
}

/** One day of history. */
export interface BenchmarkHistoryPoint {
    label: string;
    /** Entry value per tier. Missing tiers are simply absent. */
    byTier: Record<number, number>;
}

export interface BenchmarkData {
    current: BenchmarkTier[];
    history: BenchmarkHistoryPoint[];
    /** Shown when history is shorter than the requested window. */
    historyNote: string | null;
}

export async function renderBenchmark(data: BenchmarkData): Promise<Buffer> {
    const headerHeight = 70;
    const tableHeight = 44 + Math.max(data.current.length, 1) * ROW_HEIGHT;
    const chartHeight = 300;
    const height = headerHeight + tableHeight + chartHeight + 140;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, WIDTH, height);
    bg.addColorStop(0, '#191a24');
    bg.addColorStop(1, '#101119');
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, WIDTH, height, 20);
    ctx.fill();

    // ── Current benchmark table ───────────────────────────────────────────────
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = font('bold 22px');
    ctx.fillText('Current Benchmark', 40, 46);

    const colTier = 60;
    const colEntry = 620;
    const colAvg = 1060;

    const tableTop = headerHeight;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    roundRect(ctx, 40, tableTop, WIDTH - 80, 44, 10);
    ctx.fill();

    ctx.font = font('bold 12px');
    ctx.fillStyle = TEXT_FAINT;
    ctx.textAlign = 'left';
    ctx.fillText('BENCHMARK', colTier, tableTop + 27);
    ctx.textAlign = 'right';
    ctx.fillText('ENTRY  (FANS / MEMBER / DAY)', colEntry, tableTop + 27);
    ctx.fillText('AVERAGE  (FANS / MEMBER / DAY)', colAvg, tableTop + 27);

    let y = tableTop + 44;

    if (data.current.length === 0) {
        ctx.textAlign = 'left';
        ctx.font = font('16px');
        ctx.fillStyle = TEXT_FAINT;
        ctx.fillText('No benchmark data collected yet. Run a sync first.', colTier, y + 26);
    }

    for (const tier of data.current) {
        const cy = y + ROW_HEIGHT / 2 + 5;
        const style = TIER_STYLE[tier.tier];

        // Tier swatch, matching the chart's line colour for that tier.
        if (style) {
            ctx.fillStyle = style.color;
            roundRect(ctx, 40, y + 10, 4, ROW_HEIGHT - 20, 2);
            ctx.fill();
        }

        ctx.textAlign = 'left';
        ctx.font = font('bold 16px');
        ctx.fillStyle = TEXT_PRIMARY;
        ctx.fillText(`Top ${tier.tier}`, colTier, cy);

        ctx.textAlign = 'right';
        ctx.font = font('16px');
        ctx.fillStyle = TEXT_MUTED;
        ctx.fillText(formatFans(tier.entry), colEntry, cy);
        ctx.fillStyle = TEXT_PRIMARY;
        ctx.font = font('bold 16px');
        ctx.fillText(formatFans(tier.average), colAvg, cy);

        y += ROW_HEIGHT;
    }

    // ── Growth chart ──────────────────────────────────────────────────────────
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = font('bold 22px');
    ctx.fillText('Daily Benchmark Growth', 40, y + 46);

    const chartTop = y + 70;

    if (data.history.length < 2) {
        ctx.font = font('16px');
        ctx.fillStyle = TEXT_FAINT;
        ctx.fillText(
            'Not enough history yet. uma.moe does not publish past circle totals, so this chart',
            40,
            chartTop + 34,
        );
        ctx.fillText('fills in from the first sync onward — one point per day.', 40, chartTop + 58);
    } else {
        const tiers = [...new Set(data.history.flatMap((p) => Object.keys(p.byTier).map(Number)))].sort(
            (a, b) => a - b,
        );

        const series: ChartSeries[] = tiers.map((tier) => {
            const style = TIER_STYLE[tier] ?? { color: '#9ba3b4', style: 'solid' as const, marker: 'circle' as const };
            return {
                label: `Top ${tier}`,
                color: style.color,
                style: style.style,
                marker: style.marker,
                // A day missing a tier carries the previous value forward rather
                // than dropping to zero, which would draw a false cliff.
                values: data.history.map((point, i) => {
                    const value = point.byTier[tier];
                    if (value !== undefined) return value;
                    for (let back = i - 1; back >= 0; back -= 1) {
                        const previous = data.history[back]?.byTier[tier];
                        if (previous !== undefined) return previous;
                    }
                    return 0;
                }),
            };
        });

        drawChart(ctx, {
            x: 40,
            y: chartTop,
            width: WIDTH - 80,
            height: chartHeight,
            labels: data.history.map((p) => p.label),
            series,
            formatValue: formatCompactFans,
            legend: true,
            yAxisTitle: 'Fans / Member / Day',
            xAxisTitle: 'Day',
        });
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    ctx.textAlign = 'left';
    ctx.font = font('12px');
    ctx.fillStyle = '#555b6e';
    const note = data.historyNote ? `  |  ${data.historyNote}` : '';
    ctx.fillText(`Data source: uma.moe${note}`, 40, height - 22);

    return canvas.encode('png');
}
