import { createCanvas } from '@napi-rs/canvas';
import { font } from './fonts';
import { THEME, drawLabel, drawRule, drawText, placeColor } from './theme';
import type { LeaderboardPeriod, LeaderboardRow } from '../timer/service';

/**
 * The Independent Training leaderboard. Each row carries a bar scaled to the
 * leader so relative standing reads at a glance; the top four take the
 * placement tints on a left bar, matching the fan report.
 */

const WIDTH = 1000;
const MARGIN = 40;
const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 104;
const COLUMN_HEADER_HEIGHT = 40;

const PERIOD_LABELS: Record<LeaderboardPeriod, string> = {
    week: 'last 7 days',
    month: 'last 30 days',
    all: 'all time',
};

/** Formats minutes as "12h 30m", or "45m" under an hour. */
function formatDuration(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

export async function renderTimerLeaderboard(rows: LeaderboardRow[], names: Map<string, string>, period: LeaderboardPeriod): Promise<Buffer> {
    const height = HEADER_HEIGHT + COLUMN_HEADER_HEIGHT + Math.max(rows.length, 1) * ROW_HEIGHT + 56;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, WIDTH, height);

    // ── Header ────────────────────────────────────────────────────────────────
    drawText(ctx, 'INDEPENDENT TRAINING', MARGIN, 58, { spec: '500 26px', color: THEME.gold, tracking: 4 });
    const totalRuns = rows.reduce((sum, r) => sum + r.runs, 0);
    drawLabel(ctx, `${PERIOD_LABELS[period]} · ${totalRuns} run${totalRuns === 1 ? '' : 's'}`, WIDTH - MARGIN, 54, THEME.muted, 12, 'right');
    drawRule(ctx, MARGIN, HEADER_HEIGHT - 8, WIDTH - MARGIN * 2, THEME.gold, 1.5);

    const colPlace = MARGIN + 22;
    const colName = 104;
    const colBar = 400;
    const barWidth = 330;
    const colRuns = 820;
    const colTime = WIDTH - MARGIN;

    const hy = HEADER_HEIGHT + 20;
    drawLabel(ctx, '#', colPlace, hy, THEME.muted);
    drawLabel(ctx, 'Trainer', colName, hy, THEME.muted);
    drawLabel(ctx, 'Runs', colRuns, hy, THEME.muted, 12, 'right');
    drawLabel(ctx, 'Time', colTime, hy, THEME.muted, 12, 'right');
    drawRule(ctx, MARGIN, HEADER_HEIGHT + COLUMN_HEADER_HEIGHT - 6, WIDTH - MARGIN * 2, THEME.line);

    let y = HEADER_HEIGHT + COLUMN_HEADER_HEIGHT;

    if (rows.length === 0) {
        drawText(ctx, 'No runs recorded in this period yet.', colPlace, y + 28, { spec: '400 16px', color: THEME.faint });
        return canvas.encode('png');
    }

    const leaderRuns = Math.max(1, rows[0]?.runs ?? 1);

    rows.forEach((row, i) => {
        const rank = i + 1;
        const cy = y + ROW_HEIGHT / 2 + 6;
        const tint = placeColor(rank);

        if (tint) {
            ctx.fillStyle = tint;
            ctx.fillRect(MARGIN, y + 8, 3, ROW_HEIGHT - 16);
        }

        drawText(ctx, String(rank), colPlace, cy, { spec: '400 15px', color: THEME.faint });

        ctx.font = font('500 17px');
        let name = names.get(row.discordUserId) ?? row.discordUserId;
        while (ctx.measureText(name).width > colBar - colName - 24 && name.length > 1) name = `${name.slice(0, -2)}…`;
        drawText(ctx, name, colName, cy, { spec: '500 17px', color: tint ?? THEME.text });

        drawRule(ctx, colBar, cy - 7, barWidth, THEME.line, 6);
        drawRule(ctx, colBar, cy - 7, Math.max(6, barWidth * (row.runs / leaderRuns)), tint ?? THEME.muted, 6);

        drawText(ctx, String(row.runs), colRuns, cy, { spec: '700 17px', color: THEME.text, align: 'right' });
        drawText(ctx, formatDuration(row.minutes), colTime, cy, { spec: '400 14px', color: THEME.muted, align: 'right' });

        y += ROW_HEIGHT;
        drawRule(ctx, MARGIN, y - 1, WIDTH - MARGIN * 2, THEME.line);
    });

    return canvas.encode('png');
}
