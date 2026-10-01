import {
    FOOTER_HEIGHT,
    MARGIN,
    THEME,
    beginCard,
    drawEmpty,
    drawFooter,
    drawHeader,
    drawProgressBar,
    drawRankChip,
    drawTableHead,
    drawText,
    drawZebra,
    fit,
    placeColor,
} from './theme';
import type { LeaderboardPeriod, LeaderboardRow } from '../timer/service';

/**
 * The Independent Training leaderboard. Each row carries a bar scaled to the
 * leader so relative standing reads at a glance; the top three take the
 * placement tints, matching the fan report.
 */

const WIDTH = 1000;
const ROW_HEIGHT = 50;

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
    const headerBottom = 151;
    const tableTop = headerBottom + 24;
    const height = tableTop + 40 + 8 + Math.max(rows.length, 1) * ROW_HEIGHT + FOOTER_HEIGHT + 12;

    const { canvas, ctx } = beginCard(WIDTH, height);

    const totalRuns = rows.reduce((sum, r) => sum + r.runs, 0);
    const totalMinutes = rows.reduce((sum, r) => sum + r.minutes, 0);
    drawHeader(ctx, WIDTH, {
        eyebrow: `Independent Training  ·  ${PERIOD_LABELS[period]}`,
        title: 'Training leaderboard',
        subtitle: '50-minute runs tracked by the timer panel',
        stats: [
            { label: 'Runs', value: String(totalRuns), color: THEME.accent },
            { label: 'Time', value: formatDuration(totalMinutes) },
        ],
    });

    const colRankCx = MARGIN + 16;
    const colName = MARGIN + 50;
    const colBar = 420;
    const barWidth = 300;
    const colRuns = 820;
    const colTime = WIDTH - MARGIN;

    let y = drawTableHead(ctx, tableTop, WIDTH, [
        { label: '#', x: colRankCx, align: 'center' },
        { label: 'Trainer', x: colName },
        { label: 'Share of leader', x: colBar },
        { label: 'Runs', x: colRuns, align: 'right' },
        { label: 'Time', x: colTime, align: 'right' },
    ]);
    y += 8;

    if (rows.length === 0) {
        drawEmpty(ctx, y, 'No runs recorded in this period yet.');
    } else {
        const leaderRuns = Math.max(1, rows[0]?.runs ?? 1);
        rows.forEach((row, i) => {
            const rank = i + 1;
            const cy = y + ROW_HEIGHT / 2;
            const tint = placeColor(rank);
            drawZebra(ctx, y, WIDTH, ROW_HEIGHT, i);
            drawRankChip(ctx, rank, colRankCx, cy);

            const spec = '700 17px';
            const name = fit(ctx, names.get(row.discordUserId) ?? row.discordUserId, colBar - colName - 24, spec);
            drawText(ctx, name, colName, cy + 6, { spec, color: tint ?? THEME.text });

            drawProgressBar(ctx, colBar, cy, barWidth, 10, row.runs / leaderRuns, tint ?? THEME.accent);
            drawText(ctx, String(row.runs), colRuns, cy + 6, { spec: '700 17px', color: THEME.text, align: 'right' });
            drawText(ctx, formatDuration(row.minutes), colTime, cy + 6, { spec: '400 15px', color: THEME.muted, align: 'right' });
            y += ROW_HEIGHT;
        });
    }

    drawFooter(ctx, WIDTH, height, 'Akikawa  ·  one run = 50 minutes of Independent Training');
    return canvas.encode('png');
}
