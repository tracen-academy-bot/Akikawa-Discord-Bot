import { createCanvas } from '@napi-rs/canvas';
import { THEME, dashNum, drawLabel, drawRule, drawText } from './theme';
import { drawChart, type ChartSeries } from './chart';
import { formatCompactFans, formatFans } from '../fans/metrics';

/**
 * The competitive benchmark: what it takes to sit inside the top 10, 30 and
 * 100 circles, in fans per member per day -- and, when a club is supplied,
 * where that club sits against them. Normalising by member count and by day
 * is what makes circles of different sizes comparable.
 */

const WIDTH = 1200;
const MARGIN = 40;
const ROW_HEIGHT = 40;

/** Per-tier styling. Line style varies as well as colour for legibility. */
const TIER_STYLE: Record<number, { color: string; style: 'solid' | 'dashed' | 'dotted'; marker: 'circle' | 'triangle' | 'diamond' }> = {
    10: { color: THEME.gold, style: 'solid', marker: 'circle' },
    30: { color: THEME.text, style: 'dashed', marker: 'triangle' },
    100: { color: THEME.muted, style: 'dotted', marker: 'diamond' },
};

/** The club's own line stands apart from every tier colour. */
const CLUB_COLOR = THEME.place[0];

export interface BenchmarkTier {
    tier: number;
    entry: number;
    average: number;
}

export interface BenchmarkHistoryPoint {
    label: string;
    /** Entry value per tier for that day. */
    byTier: Record<number, number>;
}

export interface BenchmarkData {
    current: BenchmarkTier[];
    history: BenchmarkHistoryPoint[];
    historyNote: string | null;
    /** The club to overlay, with its fans/member/day keyed by game day. */
    club: { name: string; rateByDay: Record<number, number> } | null;
}

/** Day number parsed back out of a "Day N" label. */
function dayOf(label: string): number {
    return Number(label.replace(/\D/g, '')) || 0;
}

/** Where a rate sits relative to the current tier cutoffs. */
function describePosition(rate: number, tiers: BenchmarkTier[]): string {
    const sorted = [...tiers].sort((a, b) => a.tier - b.tier);
    for (const t of sorted) if (rate >= t.entry) return `inside top ${t.tier}`;
    const widest = sorted[sorted.length - 1];
    return widest ? `outside top ${widest.tier}` : 'unplaced';
}

export async function renderBenchmark(data: BenchmarkData): Promise<Buffer> {
    const headerHeight = 72;
    const clubRows = data.club ? 1 : 0;
    const tableHeight = 44 + (Math.max(data.current.length, 1) + clubRows) * ROW_HEIGHT;
    const chartHeight = 300;
    const height = headerHeight + tableHeight + chartHeight + 150;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, WIDTH, height);

    // ── Current benchmark table ───────────────────────────────────────────────
    drawText(ctx, 'BENCHMARK', MARGIN, 46, { spec: '500 26px', color: THEME.gold, tracking: 4 });
    drawLabel(ctx, 'fans / member / day', WIDTH - MARGIN, 44, THEME.muted, 12, 'right');
    drawRule(ctx, MARGIN, headerHeight - 6, WIDTH - MARGIN * 2, THEME.gold, 1.5);

    const colTier = MARGIN + 22;
    const colEntry = 620;
    const colAvg = WIDTH - MARGIN;
    const hy = headerHeight + 22;
    drawLabel(ctx, 'Cutoff', colTier, hy, THEME.muted);
    drawLabel(ctx, 'Entry', colEntry, hy, THEME.muted, 12, 'right');
    drawLabel(ctx, 'Average', colAvg, hy, THEME.muted, 12, 'right');
    drawRule(ctx, MARGIN, headerHeight + 32, WIDTH - MARGIN * 2, THEME.line);

    let y = headerHeight + 44;
    if (data.current.length === 0) {
        drawText(ctx, 'No benchmark data collected yet. Run a sync first.', colTier, y + 26, { spec: '400 15px', color: THEME.faint });
        y += ROW_HEIGHT;
    }

    for (const tier of data.current) {
        const cy = y + ROW_HEIGHT / 2 + 5;
        const style = TIER_STYLE[tier.tier];
        if (style) {
            ctx.fillStyle = style.color;
            ctx.fillRect(MARGIN, y + 8, 3, ROW_HEIGHT - 16);
        }
        drawText(ctx, `Top ${tier.tier}`, colTier, cy, { spec: '500 16px', color: THEME.text });
        drawText(ctx, formatFans(tier.entry), colEntry, cy, { spec: '400 16px', color: THEME.muted, align: 'right' });
        drawText(ctx, formatFans(tier.average), colAvg, cy, { spec: '700 16px', color: THEME.text, align: 'right' });
        y += ROW_HEIGHT;
        drawRule(ctx, MARGIN, y - 1, WIDTH - MARGIN * 2, THEME.line);
    }

    // The club row: its current rate and where that puts it.
    if (data.club) {
        const days = Object.keys(data.club.rateByDay).map(Number);
        const latestDay = days.length ? Math.max(...days) : 0;
        const rate = latestDay ? data.club.rateByDay[latestDay] ?? null : null;
        const cy = y + ROW_HEIGHT / 2 + 5;
        ctx.fillStyle = CLUB_COLOR;
        ctx.fillRect(MARGIN, y + 8, 3, ROW_HEIGHT - 16);
        drawText(ctx, data.club.name, colTier, cy, { spec: '500 16px', color: CLUB_COLOR });
        drawText(ctx, rate === null ? '—' : describePosition(rate, data.current), colEntry, cy, { spec: '400 14px', color: THEME.muted, align: 'right' });
        drawText(ctx, dashNum(rate), colAvg, cy, { spec: '700 16px', color: CLUB_COLOR, align: 'right' });
        y += ROW_HEIGHT;
        drawRule(ctx, MARGIN, y - 1, WIDTH - MARGIN * 2, THEME.line);
    }

    // ── Growth chart ──────────────────────────────────────────────────────────
    drawLabel(ctx, 'Daily benchmark growth', MARGIN, y + 40, THEME.gold, 12);
    const chartTop = y + 62;

    if (data.history.length < 2) {
        drawText(ctx, 'Not enough history yet. uma.moe does not publish past circle totals,', MARGIN, chartTop + 34, { spec: '400 15px', color: THEME.faint });
        drawText(ctx, 'so this chart fills in from the first sync onward, one point per day.', MARGIN, chartTop + 58, { spec: '400 15px', color: THEME.faint });
    } else {
        const tiers = [...new Set(data.history.flatMap((p) => Object.keys(p.byTier).map(Number)))].sort((a, b) => a - b);

        const series: ChartSeries[] = tiers.map((tier) => {
            const style = TIER_STYLE[tier] ?? { color: THEME.muted, style: 'solid' as const, marker: 'circle' as const };
            return {
                label: `Top ${tier}`,
                color: style.color,
                style: style.style,
                marker: style.marker,
                // A missing day carries the previous value forward rather than
                // dropping to zero, which would draw a false cliff.
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

        // The club's line, aligned to the same days. Carried forward likewise.
        if (data.club) {
            let last = 0;
            series.push({
                label: data.club.name,
                color: CLUB_COLOR,
                style: 'solid',
                marker: 'circle',
                values: data.history.map((point) => {
                    const v = data.club!.rateByDay[dayOf(point.label)];
                    if (v !== undefined) last = v;
                    return last;
                }),
            });
        }

        drawChart(ctx, {
            x: MARGIN,
            y: chartTop,
            width: WIDTH - MARGIN * 2,
            height: chartHeight,
            labels: data.history.map((p) => p.label),
            series,
            formatValue: formatCompactFans,
            legend: true,
            yAxisTitle: 'Fans / member / day',
            xAxisTitle: 'Day',
        });
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const note = data.historyNote ? `  ·  ${data.historyNote}` : '';
    drawText(ctx, `Data source: uma.moe${note}`, MARGIN, height - 22, { spec: '400 12px', color: THEME.faint });

    return canvas.encode('png');
}
