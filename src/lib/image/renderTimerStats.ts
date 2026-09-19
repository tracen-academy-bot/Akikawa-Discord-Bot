import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { THEME, drawLabel, drawRule, drawText } from './theme';
import { drawTileRow, type Tile } from './tiles';
import type { DailyRunCount, TrainerStats } from '../timer/service';

/**
 * A trainer's Independent Training statistics card.
 *
 * Drawn as an image so accumulated effort reads as substantial: large figures,
 * a bar chart of the last two weeks, one layout. The y-axis is scaled in whole
 * runs because a run is indivisible and fractional gridlines would be noise.
 */

const WIDTH = 1000;
const MARGIN = 40;

/** Formats minutes as "12h 30m", or "45m" under an hour. */
function formatDuration(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

/** Bar chart of runs per day. */
function drawHistory(ctx: SKRSContext2D, series: DailyRunCount[], x: number, y: number, w: number, h: number) {
    drawLabel(ctx, `Last ${series.length} days`, x, y - 14, THEME.gold, 11);

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
            ctx.fillStyle = THEME.gold;
            ctx.fillRect(cx - barW / 2, y + h - barH, barW, barH);
            drawText(ctx, String(day.runs), cx, y + h - barH - 7, { spec: '500 11px', color: THEME.text, align: 'center' });
        } else {
            ctx.fillStyle = THEME.line;
            ctx.fillRect(cx - barW / 2, y + h - 2, barW, 2);
        }
        if (i % 2 === series.length % 2) {
            drawText(ctx, day.label, cx, y + h + 18, { spec: '400 11px', color: THEME.faint, align: 'center' });
        }
    });
}

export async function renderTimerStats(displayName: string, stats: TrainerStats, series: DailyRunCount[]): Promise<Buffer> {
    const headerHeight = 104;
    const tileHeight = 104;
    const chartHeight = 190;
    const height = headerHeight + tileHeight + chartHeight + 156;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, WIDTH, height);

    // ── Header ────────────────────────────────────────────────────────────────
    drawLabel(ctx, 'Training report', MARGIN, 40, THEME.gold, 12);
    drawText(ctx, displayName, MARGIN, 76, { spec: '500 30px', color: THEME.text });

    const placement = stats.rank === null ? 'no runs yet' : `rank ${stats.rank} of ${stats.trainerCount}`;
    const since = stats.firstRunAt ? ` · since ${stats.firstRunAt.toISOString().slice(0, 10)}` : '';
    drawLabel(ctx, `${placement}${since}`, WIDTH - MARGIN, 40, THEME.muted, 12, 'right');
    drawText(ctx, 'Independent Training · 50 min per run', WIDTH - MARGIN, 76, { spec: '400 14px', color: THEME.gold, align: 'right' });
    drawRule(ctx, MARGIN, headerHeight - 8, WIDTH - MARGIN * 2, THEME.gold, 1.5);

    // ── Headline figures ──────────────────────────────────────────────────────
    const tiles: Tile[] = [
        { label: 'Total runs', value: String(stats.totalRuns), detail: `${stats.runsToday} today`, color: THEME.text },
        {
            label: 'Current streak',
            value: `${stats.currentStreakDays}d`,
            detail: `best ${stats.longestStreakDays}d`,
            color: stats.currentStreakDays > 0 ? THEME.gold : THEME.faint,
        },
        { label: 'This week', value: String(stats.runsThisWeek), detail: 'runs in 7 days', color: THEME.text },
        { label: 'Time trained', value: formatDuration(stats.totalMinutes), detail: 'total', color: THEME.text },
    ];
    drawTileRow(ctx, tiles, MARGIN, headerHeight + 12, WIDTH - MARGIN * 2, tileHeight);

    drawHistory(ctx, series, MARGIN, headerHeight + tileHeight + 70, WIDTH - MARGIN * 2, chartHeight);

    return canvas.encode('png');
}
