import { createCanvas } from '@napi-rs/canvas';
import { roundRect } from './canvasUtils';
import type { LeaderboardPeriod, LeaderboardRow } from '../timer/service';
import { font } from './fonts';

/**
 * Renders the Independent Training leaderboard.
 *
 * Each row carries a bar scaled against the leader, so relative standing is
 * readable at a glance instead of requiring the viewer to compare numbers.
 */

const WIDTH = 1000;
const ROW_HEIGHT = 46;
const HEADER_HEIGHT = 104;
const TABLE_HEADER_HEIGHT = 44;

const TEXT_PRIMARY = '#e6e6e6';
const TEXT_MUTED = '#9ba3b4';
const TEXT_FAINT = '#6b7280';
const HAIRLINE = 'rgba(255, 255, 255, 0.08)';

/** Medal colours for the top three, then a neutral tone for everyone else. */
const PLACE_COLORS = ['#ffd166', '#c9d1d9', '#d98c5f'];

const PERIOD_LABELS: Record<LeaderboardPeriod, string> = {
    week: 'Last 7 Days',
    month: 'Last 30 Days',
    all: 'All Time',
};

/** Formats a duration in minutes as "12h 30m", or "45m" under an hour. */
function formatDuration(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

/**
 * @param rows   Leaderboard entries, already sorted best first.
 * @param names  Display name per Discord user ID.
 * @param period Which window the rows cover.
 */
export async function renderTimerLeaderboard(
    rows: LeaderboardRow[],
    names: Map<string, string>,
    period: LeaderboardPeriod,
): Promise<Buffer> {
    const height = HEADER_HEIGHT + TABLE_HEADER_HEIGHT + Math.max(rows.length, 1) * ROW_HEIGHT + 40;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, WIDTH, height);
    bg.addColorStop(0, '#1a1c2e');
    bg.addColorStop(1, '#12131f');
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, WIDTH, height, 24);
    ctx.fill();

    // Header.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = font('bold 32px');
    ctx.fillText('Independent Training Leaderboard', 40, 52);

    ctx.font = font('17px');
    ctx.fillStyle = TEXT_MUTED;
    const totalRuns = rows.reduce((sum, r) => sum + r.runs, 0);
    ctx.fillText(`${PERIOD_LABELS[period]} • ${totalRuns} run${totalRuns === 1 ? '' : 's'} completed`, 40, 78);

    ctx.strokeStyle = HAIRLINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, HEADER_HEIGHT - 10);
    ctx.lineTo(WIDTH - 40, HEADER_HEIGHT - 10);
    ctx.stroke();

    const colPlace = 48;
    const colName = 104;
    const colBar = 360;
    const barWidth = 380;
    const colRuns = 790;
    const colTime = 880;

    ctx.font = font('bold 13px');
    ctx.fillStyle = TEXT_FAINT;
    ctx.fillText('#', colPlace, HEADER_HEIGHT + 18);
    ctx.fillText('TRAINER', colName, HEADER_HEIGHT + 18);
    ctx.fillText('RUNS', colRuns, HEADER_HEIGHT + 18);
    ctx.fillText('TIME', colTime, HEADER_HEIGHT + 18);

    let y = HEADER_HEIGHT + TABLE_HEADER_HEIGHT;

    if (rows.length === 0) {
        ctx.font = font('18px');
        ctx.fillStyle = TEXT_FAINT;
        ctx.fillText('No runs recorded in this period yet.', colPlace, y + 28);
        return canvas.encode('png');
    }

    // Bars are relative to the leader, so first place always fills the track.
    const leaderRuns = Math.max(1, rows[0]?.runs ?? 1);

    rows.forEach((row, i) => {
        if (i % 2 === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.fillRect(24, y, WIDTH - 48, ROW_HEIGHT);
        }

        const cy = y + ROW_HEIGHT / 2;
        const placeColor = PLACE_COLORS[i] ?? TEXT_FAINT;

        ctx.textAlign = 'left';
        ctx.font = font('bold 17px');
        ctx.fillStyle = placeColor;
        ctx.fillText(`${i + 1}`, colPlace, cy + 6);

        ctx.font = font('17px');
        ctx.fillStyle = TEXT_PRIMARY;
        const name = names.get(row.discordUserId) ?? row.discordUserId;
        // Truncate rather than overflow into the bar column.
        const maxNameWidth = colBar - colName - 20;
        let shown = name;
        while (ctx.measureText(shown).width > maxNameWidth && shown.length > 1) {
            shown = `${shown.slice(0, -2)}…`;
        }
        ctx.fillText(shown, colName, cy + 6);

        const barHeight = 10;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        roundRect(ctx, colBar, cy - barHeight / 2, barWidth, barHeight, barHeight / 2);
        ctx.fill();

        const filled = Math.max(barHeight, barWidth * (row.runs / leaderRuns));
        ctx.fillStyle = placeColor;
        roundRect(ctx, colBar, cy - barHeight / 2, filled, barHeight, barHeight / 2);
        ctx.fill();

        ctx.font = font('bold 17px');
        ctx.fillStyle = TEXT_PRIMARY;
        ctx.fillText(String(row.runs), colRuns, cy + 6);

        ctx.font = font('15px');
        ctx.fillStyle = TEXT_MUTED;
        ctx.fillText(formatDuration(row.minutes), colTime, cy + 6);

        y += ROW_HEIGHT;
    });

    return canvas.encode('png');
}
