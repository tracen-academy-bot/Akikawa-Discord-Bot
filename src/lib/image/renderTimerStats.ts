import type { SKRSContext2D } from '@napi-rs/canvas';
import { FOOTER_HEIGHT, MARGIN, THEME, beginCard, drawFooter, drawHeader, drawLabel, drawRule, drawText, fillRoundRect } from './theme';
import { drawTileRow, type Tile } from './tiles';
import type { DailyRunCount, HourlyHeatmap, TrainerStats } from '../timer/service';

/**
 * A trainer's Independent Training statistics card.
 *
 * Drawn as an image so accumulated effort reads as substantial: large figures,
 * a bar chart of the last two weeks, one layout. The y-axis is scaled in whole
 * runs because a run is indivisible and fractional gridlines would be noise.
 */

const WIDTH = 1000;

/** Formats minutes as "12h 30m", or "45m" under an hour. */
function formatDuration(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

/** Bar chart of runs per day. */
function drawHistory(ctx: SKRSContext2D, series: DailyRunCount[], x: number, y: number, w: number, h: number) {
    drawLabel(ctx, `Last ${series.length} days`, x, y - 18, THEME.muted, 11);

    const peak = Math.max(1, ...series.map((d) => d.runs));
    const step = Math.max(1, Math.ceil(peak / 4));
    const top = Math.ceil(peak / step) * step;
    const axisW = 34;

    for (let value = 0; value <= top; value += step) {
        const lineY = y + h - (value / top) * h;
        drawRule(ctx, x + axisW, lineY, w - axisW, THEME.line);
        drawText(ctx, String(value), x + axisW - 10, lineY + 4, { spec: '400 11px', color: THEME.faint, align: 'right' });
    }

    const plotX = x + axisW;
    const slot = (w - axisW) / series.length;
    const barW = Math.min(30, slot * 0.55);

    series.forEach((day, i) => {
        const cx = plotX + slot * i + slot / 2;
        const barH = (day.runs / top) * h;
        if (day.runs > 0) {
            fillRoundRect(ctx, cx - barW / 2, y + h - barH, barW, barH, Math.min(6, barW / 2), THEME.accent);
            drawText(ctx, String(day.runs), cx, y + h - barH - 7, { spec: '700 12px', color: THEME.text, align: 'center' });
        } else {
            ctx.fillStyle = THEME.line;
            ctx.fillRect(cx - barW / 2, y + h - 2, barW, 2);
        }
        if (i % 2 === series.length % 2) {
            drawText(ctx, day.label, cx, y + h + 18, { spec: '400 11px', color: THEME.faint, align: 'center' });
        }
    });
}

/**
 * Hour-of-week heatmap: when this trainer actually trains.
 *
 * Intensity is the accent at increasing opacity against the card;
 * empty cells keep a faint outline so the grid stays readable when sparse.
 */
function drawHeatmap(ctx: SKRSContext2D, heatmap: HourlyHeatmap, x: number, y: number, w: number) {
    drawLabel(ctx, `When you train \u00b7 last ${heatmap.days} days`, x, y - 18, THEME.muted, 11);

    const labelW = 34;
    const cellGap = 2;
    const cellW = (w - labelW - cellGap * 23) / 24;
    const cellH = 14;
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    days.forEach((day, r) => {
        const rowY = y + r * (cellH + cellGap);
        drawText(ctx, day, x + labelW - 10, rowY + cellH - 3, { spec: '400 10px', color: THEME.faint, align: 'right' });
        for (let h = 0; h < 24; h += 1) {
            const count = heatmap.grid[r]?.[h] ?? 0;
            const cx = x + labelW + h * (cellW + cellGap);
            if (count === 0) {
                fillRoundRect(ctx, cx, rowY, cellW, cellH, 3, THEME.surfaceAlt);
                continue;
            }
            const alpha = heatmap.max > 0 ? 0.25 + 0.75 * (count / heatmap.max) : 1;
            ctx.globalAlpha = alpha;
            fillRoundRect(ctx, cx, rowY, cellW, cellH, 3, THEME.accent);
            ctx.globalAlpha = 1;
        }
    });

    const axisY = y + 7 * (cellH + cellGap) + 14;
    for (let h = 0; h < 24; h += 3) {
        const cx = x + labelW + h * (cellW + cellGap);
        drawText(ctx, `${String(h).padStart(2, '0')}`, cx, axisY, { spec: '400 10px', color: THEME.faint });
    }
    drawText(ctx, 'JST', x + w, axisY, { spec: '400 10px', color: THEME.faint, align: 'right' });
}

export async function renderTimerStats(
    displayName: string,
    stats: TrainerStats,
    series: DailyRunCount[],
    heatmap: HourlyHeatmap,
): Promise<Buffer> {
    const headerBottom = 151;
    const tileHeight = 108;
    const chartHeight = 190;
    const heatmapHeight = 7 * 16 + 30;
    const tilesTop = headerBottom + 24;
    const chartTop = tilesTop + tileHeight + 70;
    const heatmapTop = chartTop + chartHeight + 76;
    const height = heatmapTop + heatmapHeight + FOOTER_HEIGHT + 10;

    const { canvas, ctx } = beginCard(WIDTH, height);

    const since = stats.firstRunAt ? `  ·  since ${stats.firstRunAt.toISOString().slice(0, 10)}` : '';
    drawHeader(ctx, WIDTH, {
        eyebrow: 'Training report',
        title: displayName,
        subtitle: `Independent Training  ·  50 min per run${since}`,
        stats: [{ label: 'Rank', value: stats.rank === null ? '—' : `${stats.rank}/${stats.trainerCount}`, color: THEME.accent }],
    });

    // ── Headline figures ──────────────────────────────────────────────────────
    const tiles: Tile[] = [
        { label: 'Total runs', value: String(stats.totalRuns), detail: `${stats.runsToday} today`, color: THEME.text },
        {
            label: 'Current streak',
            value: `${stats.currentStreakDays}d`,
            detail: `best ${stats.longestStreakDays}d`,
            color: stats.currentStreakDays > 0 ? THEME.accent : THEME.faint,
        },
        { label: 'This week', value: String(stats.runsThisWeek), detail: 'runs in 7 days', color: THEME.text },
        { label: 'Time trained', value: formatDuration(stats.totalMinutes), detail: 'total', color: THEME.text },
    ];
    drawTileRow(ctx, tiles, MARGIN, tilesTop, WIDTH - MARGIN * 2, tileHeight, 16);

    drawHistory(ctx, series, MARGIN, chartTop, WIDTH - MARGIN * 2, chartHeight);
    drawHeatmap(ctx, heatmap, MARGIN, heatmapTop, WIDTH - MARGIN * 2);
    drawFooter(ctx, WIDTH, height, 'Akikawa  ·  times shown in JST');

    return canvas.encode('png');
}
