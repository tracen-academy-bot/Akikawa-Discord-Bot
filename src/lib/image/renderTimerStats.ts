import { createCanvas } from '@napi-rs/canvas';
import { roundRect } from './canvasUtils';
import type { DailyRunCount, TrainerStats } from '../timer/service';

/**
 * Renders a trainer's Independent Training statistics card.
 *
 * Drawn as an image rather than an embed because the point of the card is to
 * make accumulated effort feel substantial: large figures, a filled history
 * chart, and a consistent layout read better than embed fields.
 */

const WIDTH = 1000;
const BACKGROUND_TOP = '#1a1c2e';
const BACKGROUND_BOTTOM = '#12131f';
const TEXT_PRIMARY = '#ffffff';
const TEXT_MUTED = '#9ba3b4';
const TEXT_FAINT = '#6b7280';
const ACCENT = '#f4b13f';
const HAIRLINE = 'rgba(255, 255, 255, 0.08)';

/** One headline figure on the card. */
interface Tile {
    label: string;
    value: string;
    /** Optional smaller line under the value, e.g. a personal best. */
    detail?: string;
    color: string;
}

/** Formats a duration in minutes as "12h 30m", or "45m" under an hour. */
function formatDuration(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

/** Draws a rounded stat tile with a label, a large value, and optional detail. */
function drawTile(
    ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
    tile: Tile,
    x: number,
    y: number,
    w: number,
    h: number,
) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = HAIRLINE;
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 14);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = TEXT_FAINT;
    ctx.fillText(tile.label.toUpperCase(), x + 18, y + 28);

    ctx.font = 'bold 34px sans-serif';
    ctx.fillStyle = tile.color;
    ctx.fillText(tile.value, x + 18, y + 70);

    if (tile.detail) {
        ctx.font = '13px sans-serif';
        ctx.fillStyle = TEXT_MUTED;
        ctx.fillText(tile.detail, x + 18, y + 92);
    }
}

/**
 * Draws the daily-run history as a bar chart.
 *
 * The y-axis is scaled to whole runs, because a run is an indivisible unit and
 * fractional gridlines would be meaningless.
 */
function drawHistory(
    ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
    series: DailyRunCount[],
    x: number,
    y: number,
    w: number,
    h: number,
) {
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = TEXT_FAINT;
    ctx.fillText(`LAST ${series.length} DAYS`, x, y - 14);

    const peak = Math.max(1, ...series.map((d) => d.runs));
    // At most 4 gridlines, and never a fractional number of runs.
    const step = Math.max(1, Math.ceil(peak / 4));
    const top = Math.ceil(peak / step) * step;

    // Gridlines and y-axis labels.
    ctx.textAlign = 'right';
    ctx.font = '12px sans-serif';
    for (let value = 0; value <= top; value += step) {
        const lineY = y + h - (value / top) * h;
        ctx.strokeStyle = HAIRLINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 34, lineY);
        ctx.lineTo(x + w, lineY);
        ctx.stroke();

        ctx.fillStyle = TEXT_FAINT;
        ctx.fillText(String(value), x + 26, lineY + 4);
    }

    const plotX = x + 34;
    const plotW = w - 34;
    const slot = plotW / series.length;
    const barW = Math.min(36, slot * 0.6);

    series.forEach((day, i) => {
        const cx = plotX + slot * i + slot / 2;
        const barH = (day.runs / top) * h;

        if (day.runs > 0) {
            ctx.fillStyle = ACCENT;
            roundRect(ctx, cx - barW / 2, y + h - barH, barW, barH, Math.min(5, barW / 2));
            ctx.fill();

            ctx.textAlign = 'center';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillStyle = TEXT_PRIMARY;
            ctx.fillText(String(day.runs), cx, y + h - barH - 7);
        } else {
            // An empty day still gets a faint baseline so the axis reads evenly.
            ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
            roundRect(ctx, cx - barW / 2, y + h - 3, barW, 3, 1.5);
            ctx.fill();
        }

        // Label every other day to avoid crowding on a 14-day axis.
        if (i % 2 === series.length % 2) {
            ctx.textAlign = 'center';
            ctx.font = '11px sans-serif';
            ctx.fillStyle = TEXT_FAINT;
            ctx.fillText(day.label, cx, y + h + 18);
        }
    });
}

/**
 * Renders the full statistics card.
 *
 * @param displayName Trainer's server display name.
 * @param stats       Aggregated totals for that trainer.
 * @param series      Per-day run counts, oldest first.
 */
export async function renderTimerStats(
    displayName: string,
    stats: TrainerStats,
    series: DailyRunCount[],
): Promise<Buffer> {
    const headerHeight = 96;
    const tileHeight = 108;
    const chartHeight = 190;
    // Bottom padding leaves room for the date axis under the chart plus the
    // footer line, without the two crowding each other.
    const height = headerHeight + tileHeight + chartHeight + 152;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, WIDTH, height);
    bg.addColorStop(0, BACKGROUND_TOP);
    bg.addColorStop(1, BACKGROUND_BOTTOM);
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, WIDTH, height, 24);
    ctx.fill();

    // Header.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(`Training Report — ${displayName}`, 40, 54);

    ctx.font = '17px sans-serif';
    ctx.fillStyle = TEXT_MUTED;
    const placement =
        stats.rank === null
            ? 'No runs recorded yet'
            : `Rank #${stats.rank} of ${stats.trainerCount} trainers`;
    const since = stats.firstRunAt
        ? ` • Training since ${stats.firstRunAt.toISOString().slice(0, 10)}`
        : '';
    ctx.fillText(`${placement}${since}`, 40, 80);

    ctx.strokeStyle = HAIRLINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, headerHeight);
    ctx.lineTo(WIDTH - 40, headerHeight);
    ctx.stroke();

    // Headline figures.
    const tiles: Tile[] = [
        { label: 'Total Runs', value: String(stats.totalRuns), detail: `${stats.runsToday} today`, color: TEXT_PRIMARY },
        {
            label: 'Current Streak',
            value: `${stats.currentStreakDays}d`,
            detail: `Best ${stats.longestStreakDays}d`,
            color: stats.currentStreakDays > 0 ? ACCENT : TEXT_FAINT,
        },
        { label: 'This Week', value: String(stats.runsThisWeek), detail: 'runs in 7 days', color: '#7ee787' },
        { label: 'Time Trained', value: formatDuration(stats.totalMinutes), detail: 'total', color: '#79c0ff' },
    ];

    const gutter = 18;
    const tileWidth = (WIDTH - 80 - gutter * 3) / 4;
    tiles.forEach((tile, i) => {
        drawTile(ctx, tile, 40 + i * (tileWidth + gutter), headerHeight + 22, tileWidth, tileHeight);
    });

    drawHistory(ctx, series, 40, headerHeight + tileHeight + 74, WIDTH - 80, chartHeight);

    ctx.textAlign = 'left';
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#555b6e';
    ctx.fillText('Independent Training • 50 minutes per run', 40, height - 22);

    return canvas.encode('png');
}
