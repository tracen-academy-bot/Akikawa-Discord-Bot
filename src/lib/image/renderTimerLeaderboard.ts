import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { DEFAULT_PALETTE, PALETTES, type Palette } from './theme';
import { RENDER_SCALE, card, drawFrame, fillRound, fit, innerRadius, label, text } from './cards';
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

// ─── Live board ───────────────────────────────────────────────────────────────

/** Rows of this week shown on the live board. */
export const LIVE_WEEK_ROWS = 10;
/** Rows of today shown on the live board. */
export const LIVE_DAY_ROWS = 5;

/** What the live board shows beside the two boards. */
export interface LiveBoardInfo {
    /** The weekly role's name, for the line over the week. */
    topRoleName: string | null;
    /** "Mon Oct 26": today in the timer's time zone. */
    dayLabel: string;
    /** "12:34 JST": when the image was drawn. */
    updatedLabel: string;
}

/**
 * The live leaderboard kept above the timer panel: this week so far on the
 * left (top 3 in their place colours, then the rest with a bar against the
 * leader), and today on the right (the day's runs, then its top 5).
 * Rendered at `RENDER_SCALE`.
 */
export async function renderLiveBoard(
    week: Board,
    today: Board,
    names: Map<string, string>,
    info: LiveBoardInfo,
    palette: Palette = PALETTES[DEFAULT_PALETTE]!,
): Promise<Buffer> {
    const p = palette;
    const width = WIDTH;
    const cardX = FRAME;
    const cardW = width - FRAME * 2;
    const headerH = 84;
    const dayW = 270;
    const weekW = cardW - dayW - GAP;
    const rowH = 34;
    const weekRows = week.rows.slice(0, LIVE_WEEK_ROWS);
    const dayRows = today.rows.slice(0, LIVE_DAY_ROWS);
    const roleLine = info.topRoleName !== null && weekRows.length > 0;
    const weekH = PAD + 18 + (roleLine ? 22 : 0) + 10 + Math.max(1, weekRows.length) * rowH + PAD - 6;
    const dayH = PAD + 18 + 12 + 56 + 10 + Math.max(1, dayRows.length) * rowH + PAD - 6;
    const bodyH = Math.max(weekH, dayH);
    const height = FRAME + headerH + GAP + bodyH + FRAME;

    const canvas = createCanvas(width * RENDER_SCALE, height * RENDER_SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(RENDER_SCALE, RENDER_SCALE);
    drawFrame(ctx, width, height, p);

    // Header: title and week on the left, the week's totals on the right.
    let y = FRAME;
    card(ctx, cardX, y, cardW, headerH, p);
    text(ctx, 'Independent Training · live', cardX + PAD, y + 38, { spec: '700 24px', color: p.text });
    text(ctx, `This week · ${week.week ? weekLabel(week.week) : ''} · updated ${info.updatedLabel}`, cardX + PAD, y + 64, { spec: '400 14px', color: p.muted });
    text(ctx, `${week.totalRuns}`, cardX + cardW - PAD, y + 40, { spec: '700 26px', color: p.text, align: 'right' });
    text(ctx, `runs · ${week.trainers} trainer${week.trainers === 1 ? '' : 's'}`, cardX + cardW - PAD, y + 64, { spec: '400 14px', color: p.muted, align: 'right' });
    y += headerH + GAP;

    // This week.
    card(ctx, cardX, y, weekW, bodyH, p);
    let wy = y + PAD;
    label(ctx, 'This week', cardX + PAD, wy + 12, 14, p.muted, p);
    wy += 18;
    if (roleLine) {
        text(ctx, `Top ${TOP_PLACES} on Monday take ${info.topRoleName}`, cardX + PAD, wy + 14, { spec: '400 13px', color: p.faint });
        wy += 22;
    }
    wy += 10;
    if (weekRows.length === 0) {
        text(ctx, 'No runs yet this week.', cardX + PAD, wy + 22, { spec: '400 15px', color: p.faint });
    }
    const leader = Math.max(1, weekRows[0]?.runs ?? 1);
    const nameX = cardX + PAD + 30;
    const barX = cardX + weekW - PAD - 200;
    const runsX = cardX + weekW - PAD;
    weekRows.forEach((row, i) => {
        if (i % 2 === 1) fillRound(ctx, cardX + 8, wy, weekW - 16, rowH, innerRadius(p), p.stripe);
        const by = wy + rowH / 2 + 6;
        const tint = i < TOP_PLACES ? p.place[i] : undefined;
        text(ctx, `${i + 1}`, cardX + PAD + 16, by, { spec: '700 15px', color: tint ?? p.muted, align: 'right' });
        const spec = i < TOP_PLACES ? '700 16px' : '400 16px';
        text(ctx, fit(ctx, names.get(row.discordUserId) ?? row.discordUserId, barX - nameX - 14, spec), nameX, by, { spec, color: tint ?? p.text });
        fillRound(ctx, barX, by - 8, 140, 6, 3, p.line);
        fillRound(ctx, barX, by - 8, Math.max(6, (140 * row.runs) / leader), 6, 3, tint ?? p.accent);
        text(ctx, `${row.runs}`, runsX, by, { spec: '700 16px', color: p.text, align: 'right' });
        wy += rowH;
    });

    // Today.
    const dx = cardX + weekW + GAP;
    card(ctx, dx, y, dayW, bodyH, p);
    let dy = y + PAD;
    label(ctx, `Today · ${info.dayLabel}`, dx + PAD, dy + 12, 14, p.muted, p);
    dy += 18 + 12;
    text(ctx, `${today.totalRuns}`, dx + PAD, dy + 34, { spec: '700 34px', color: p.text });
    text(ctx, `run${today.totalRuns === 1 ? '' : 's'} · ${today.trainers} trainer${today.trainers === 1 ? '' : 's'}`, dx + PAD, dy + 54, { spec: '400 13px', color: p.muted });
    dy += 56 + 10;
    if (dayRows.length === 0) {
        text(ctx, 'No runs yet today.', dx + PAD, dy + 22, { spec: '400 15px', color: p.faint });
    }
    dayRows.forEach((row, i) => {
        if (i % 2 === 1) fillRound(ctx, dx + 8, dy, dayW - 16, rowH, innerRadius(p), p.stripe);
        const by = dy + rowH / 2 + 6;
        text(ctx, `${i + 1}`, dx + PAD + 10, by, { spec: '400 14px', color: p.muted, align: 'right' });
        const runsW = text(ctx, `${row.runs}`, dx + dayW - PAD, by, { spec: '700 15px', color: p.good, align: 'right' });
        text(ctx, fit(ctx, names.get(row.discordUserId) ?? row.discordUserId, dayW - PAD * 2 - 30 - runsW - 8, '400 15px'), dx + PAD + 22, by, { spec: '400 15px', color: p.text });
        dy += rowH;
    });

    return canvas.encode('png');
}
