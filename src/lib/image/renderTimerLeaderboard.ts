import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { DEFAULT_PALETTE, PALETTES, type Palette } from './theme';
import { card, drawFrame, fillRound, fit, innerRadius, label, text } from './cards';
import { TOP_PLACES, weekLabel, type Board, type BoardPeriod } from '../timer/rewards';
import type { LeaderboardRow } from '../timer/service';

/**
 * The Independent Training leaderboard, in the fan report's card style.
 *
 *   header   the window ("This week · live", "Last week · final"), its
 *            dates, and the total runs and trainers
 *   podium   the top 3 as three cards; for a week, a line on the weekly
 *            role: who is on track for it (live) or who took it (final)
 *   rows     everyone else, with a bar against the leader
 */

const WIDTH = 900;
const FRAME = 16;
const GAP = 12;
const PAD = 24;
const ROW = 40;
const PODIUM_HEIGHT = 150;

const PERIOD_TITLES: Record<BoardPeriod, string> = {
    thisweek: 'This week · live',
    lastweek: 'Last week · final',
    month: 'Last 30 days',
    all: 'All time',
};


/** "12h 30m", or "45m" under an hour. */
function formatDuration(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

/** Draws one podium card: place, name, runs and time, tinted by place. */
function drawPodiumCard(ctx: SKRSContext2D, row: LeaderboardRow, place: number, name: string, x: number, y: number, w: number, h: number, p: Palette) {
    fillRound(ctx, x, y, w, h, innerRadius(p) + 4, p.panel);
    const tint = p.place[place - 1] ?? p.accent;
    fillRound(ctx, x, y, w, 4, 2, tint);
    text(ctx, `${place}`, x + 18, y + 44, { spec: '700 30px', color: tint });
    text(ctx, fit(ctx, name, w - 36, '700 18px'), x + 18, y + 76, { spec: '700 18px', color: p.text });
    const runsWidth = text(ctx, `${row.runs}`, x + 18, y + 114, { spec: '700 26px', color: p.text });
    text(ctx, row.runs === 1 ? 'run' : 'runs', x + 18 + runsWidth + 8, y + 114, { spec: '400 14px', color: p.muted });
    text(ctx, formatDuration(row.minutes), x + w - 18, y + 114, { spec: '400 14px', color: p.muted, align: 'right' });
}

/**
 * Renders a leaderboard. `names` maps user IDs to display names (rows
 * without one show the ID); `topRoleName` is the weekly role's name, when the
 * guild has one, for the line over the podium.
 */
export async function renderTimerLeaderboard(
    board: Board,
    names: Map<string, string>,
    topRoleName: string | null = null,
    palette: Palette = PALETTES[DEFAULT_PALETTE]!,
): Promise<Buffer> {
    const p = palette;
    const { rows } = board;
    const info = { period: board.period, week: board.week, topRoleName };
    const cardX = FRAME;
    const cardW = WIDTH - FRAME * 2;
    const podium = rows.slice(0, TOP_PLACES);
    const rest = rows.slice(TOP_PLACES);
    const weekly = info.week !== null;
    const roleLine = weekly && info.topRoleName !== null && podium.length > 0;

    const headerH = 96;
    const podiumH = podium.length > 0 ? PAD + (roleLine ? 26 : 0) + PODIUM_HEIGHT + PAD : 0;
    const restH = rest.length > 0 ? 12 + rest.length * ROW + 12 : 0;
    const emptyH = rows.length === 0 ? 80 : 0;
    const height = FRAME + headerH + GAP + (podiumH || emptyH) + (restH > 0 ? GAP + restH : 0) + FRAME;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, WIDTH, height, p);

    // Header: title and window on the left, totals on the right.
    let y = FRAME;
    card(ctx, cardX, y, cardW, headerH, p);
    text(ctx, 'Independent Training', cardX + PAD, y + 42, { spec: '700 26px', color: p.text });
    const window = weekly ? `${PERIOD_TITLES[info.period]} · ${weekLabel(info.week!)}` : PERIOD_TITLES[info.period];
    text(ctx, window, cardX + PAD, y + 70, { spec: '400 15px', color: p.muted });
    text(ctx, `${board.totalRuns}`, cardX + cardW - PAD, y + 46, { spec: '700 28px', color: p.text, align: 'right' });
    text(ctx, `runs · ${board.trainers} trainer${board.trainers === 1 ? '' : 's'}`, cardX + cardW - PAD, y + 70, {
        spec: '400 14px',
        color: p.muted,
        align: 'right',
    });
    y += headerH + GAP;

    if (rows.length === 0) {
        card(ctx, cardX, y, cardW, emptyH, p);
        text(ctx, 'No runs recorded in this period yet.', cardX + PAD, y + 46, { spec: '400 16px', color: p.faint });
        return canvas.encode('png');
    }

    // Podium: the top 3 side by side.
    card(ctx, cardX, y, cardW, podiumH, p);
    let py = y + PAD;
    if (roleLine) {
        const line =
            info.period === 'thisweek'
                ? `On track for ${info.topRoleName}: the top ${TOP_PLACES} when the week ends`
                : `Now holding ${info.topRoleName}`;
        label(ctx, line, cardX + PAD, py + 12, 14, p.muted, p);
        py += 26;
    }
    const slotW = (cardW - PAD * 2 - GAP * (TOP_PLACES - 1)) / TOP_PLACES;
    podium.forEach((row, i) => {
        drawPodiumCard(ctx, row, i + 1, names.get(row.discordUserId) ?? row.discordUserId, cardX + PAD + i * (slotW + GAP), py, slotW, PODIUM_HEIGHT, p);
    });
    y += podiumH;

    // Everyone else, with a bar against the leader.
    if (rest.length > 0) {
        y += GAP;
        card(ctx, cardX, y, cardW, restH, p);
        const leader = Math.max(1, rows[0]!.runs);
        const colName = cardX + PAD + 44;
        const colBar = cardX + 420;
        const barW = 260;
        const colRuns = cardX + cardW - PAD - 110;
        const colTime = cardX + cardW - PAD;
        let ry = y + 12;
        rest.forEach((row, i) => {
            if (i % 2 === 1) fillRound(ctx, cardX + 8, ry, cardW - 16, ROW, innerRadius(p), p.stripe);
            const by = ry + ROW / 2 + 6;
            text(ctx, `${TOP_PLACES + i + 1}`, cardX + PAD + 28, by, { spec: '400 16px', color: p.muted, align: 'right' });
            const name = names.get(row.discordUserId) ?? row.discordUserId;
            text(ctx, fit(ctx, name, colBar - colName - 20, '400 17px'), colName, by, { spec: '400 17px', color: p.text });
            fillRound(ctx, colBar, by - 9, barW, 6, 3, p.line);
            fillRound(ctx, colBar, by - 9, Math.max(6, (barW * row.runs) / leader), 6, 3, p.accent);
            text(ctx, `${row.runs}`, colRuns, by, { spec: '700 17px', color: p.text, align: 'right' });
            text(ctx, formatDuration(row.minutes), colTime, by, { spec: '400 14px', color: p.muted, align: 'right' });
            ry += ROW;
        });
    }

    return canvas.encode('png');
}
