import {
    FOOTER_HEIGHT,
    MARGIN,
    THEME,
    beginCard,
    dashNum,
    drawFooter,
    drawHeader,
    drawLabel,
    drawTableHead,
    drawText,
    drawZebra,
    fillRoundRect,
} from './theme';
import { drawChart, type ChartSeries } from './chart';
import { formatCompactFans, formatFans } from '../fans/metrics';

/**
 * The competitive benchmark: what it takes to sit inside the top 10, 30 and
 * 100 circles, in fans per member per day -- and, when a club is supplied,
 * where that club sits against them. Normalising by member count and by day
 * is what makes circles of different sizes comparable.
 */

const WIDTH = 1200;
const ROW_HEIGHT = 48;

/** Per-tier styling. Line style varies as well as colour for legibility. */
const TIER_STYLE: Record<number, { color: string; style: 'solid' | 'dashed' | 'dotted'; marker: 'circle' | 'triangle' | 'diamond' }> = {
    10: { color: THEME.place[0], style: 'solid', marker: 'circle' },
    30: { color: THEME.accent, style: 'dashed', marker: 'triangle' },
    100: { color: THEME.muted, style: 'dotted', marker: 'diamond' },
};

/** The club's own line stands apart from every tier colour. */
const CLUB_COLOR = THEME.violet;

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
    const headerBottom = 151;
    const clubRows = data.club ? 1 : 0;
    const tableTop = headerBottom + 24;
    const tableHeight = 40 + 8 + (Math.max(data.current.length, 1) + clubRows) * ROW_HEIGHT;
    // Without history there is only a two-line note, so do not reserve the plot.
    const chartHeight = data.history.length < 2 ? 70 : 300;
    const height = tableTop + tableHeight + 70 + chartHeight + FOOTER_HEIGHT + 30;

    const { canvas, ctx } = beginCard(WIDTH, height);

    const top10 = data.current.find((t) => t.tier === 10);
    drawHeader(ctx, WIDTH, {
        eyebrow: 'Benchmark  ·  fans per member per day',
        title: 'What the top circles earn',
        subtitle: 'Entry is the lowest circle inside each cutoff; average is across the circles inside it.',
        stats: top10 ? [{ label: 'Top 10 entry', value: formatCompactFans(top10.entry), color: THEME.place[0] }] : [],
    });

    // ── Current benchmark table ───────────────────────────────────────────────
    const colTier = MARGIN + 20;
    const colEntry = 700;
    const colAvg = WIDTH - MARGIN;
    let y = drawTableHead(ctx, tableTop, WIDTH, [
        { label: 'Cutoff', x: colTier },
        { label: 'Entry', x: colEntry, align: 'right' },
        { label: 'Average', x: colAvg, align: 'right' },
    ]);
    y += 8;

    if (data.current.length === 0) {
        drawText(ctx, 'No benchmark data collected yet. Run a sync first.', colTier, y + 30, { spec: '400 16px', color: THEME.faint });
        y += ROW_HEIGHT;
    }

    data.current.forEach((tier, i) => {
        drawZebra(ctx, y, WIDTH, ROW_HEIGHT, i);
        const cy = y + ROW_HEIGHT / 2 + 6;
        const style = TIER_STYLE[tier.tier];
        if (style) fillRoundRect(ctx, MARGIN - 4, y + 12, 6, ROW_HEIGHT - 24, 3, style.color);
        drawText(ctx, `Top ${tier.tier}`, colTier, cy, { spec: '700 17px', color: style?.color ?? THEME.text });
        drawText(ctx, formatFans(tier.entry), colEntry, cy, { spec: '400 17px', color: THEME.muted, align: 'right' });
        drawText(ctx, formatFans(tier.average), colAvg, cy, { spec: '700 17px', color: THEME.text, align: 'right' });
        y += ROW_HEIGHT;
    });

    // The club row: its current rate and where that puts it.
    if (data.club) {
        const days = Object.keys(data.club.rateByDay).map(Number);
        const latestDay = days.length ? Math.max(...days) : 0;
        const rate = latestDay ? data.club.rateByDay[latestDay] ?? null : null;
        const cy = y + ROW_HEIGHT / 2 + 6;
        fillRoundRect(ctx, MARGIN - 12, y + 4, WIDTH - (MARGIN - 12) * 2, ROW_HEIGHT - 8, 10, `${CLUB_COLOR}1f`);
        fillRoundRect(ctx, MARGIN - 4, y + 12, 6, ROW_HEIGHT - 24, 3, CLUB_COLOR);
        drawText(ctx, data.club.name, colTier, cy, { spec: '700 17px', color: CLUB_COLOR });
        drawText(ctx, rate === null ? '—' : describePosition(rate, data.current), colEntry, cy, { spec: '400 15px', color: THEME.muted, align: 'right' });
        drawText(ctx, dashNum(rate), colAvg, cy, { spec: '700 17px', color: CLUB_COLOR, align: 'right' });
        y += ROW_HEIGHT;
    }

    // ── Growth chart ──────────────────────────────────────────────────────────
    drawLabel(ctx, 'Daily benchmark growth', MARGIN, y + 46, THEME.muted, 11);
    const chartTop = y + 66;

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
    drawFooter(ctx, WIDTH, height, `Data source: uma.moe${data.historyNote ? `  ·  ${data.historyNote}` : ''}`);

    return canvas.encode('png');
}
