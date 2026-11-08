import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { DEFAULT_PALETTE, PALETTES, type Palette } from './theme';
import { card, drawFrame, fillRound, fit, innerRadius, label, text } from './cards';
import type { SpecialsBoard, SpecialsBoardRow } from '../timer/rares';

/**
 * The specials leaderboard, in the same card style as the runs board.
 *
 *   header   "Specials · all time", how the board is ranked, and the
 *            server's special pings and trainers
 *   podium   the top 3: specials found (of all), sets completed, pings
 *   rows     everyone else, with a bar of specials found against the total
 *
 * Ranked by sets completed, then specials found, then pings (see
 * `specialsBoard`), so every number the order depends on is on the image.
 */

const WIDTH = 900;
const FRAME = 16;
const GAP = 12;
const PAD = 24;
const ROW = 40;
const PODIUM_HEIGHT = 150;
const TOP = 3;

/** "1 set", "2 sets". */
function sets(n: number): string {
    return `${n} set${n === 1 ? '' : 's'}`;
}

/** "1 ping", "31 pings". */
function pings(n: number): string {
    return `${n} ping${n === 1 ? '' : 's'}`;
}

/** One podium card: place, name, specials found of all, sets and pings. */
function drawPodiumCard(ctx: SKRSContext2D, row: SpecialsBoardRow, place: number, name: string, of: number, x: number, y: number, w: number, h: number, p: Palette) {
    fillRound(ctx, x, y, w, h, innerRadius(p) + 4, p.panel);
    const tint = p.place[place - 1] ?? p.accent;
    fillRound(ctx, x, y, w, 4, 2, tint);
    text(ctx, `${place}`, x + 18, y + 44, { spec: '700 30px', color: tint });
    text(ctx, fit(ctx, name, w - 36, '700 18px'), x + 18, y + 76, { spec: '700 18px', color: p.text });
    const foundWidth = text(ctx, `${row.found}`, x + 18, y + 108, { spec: '700 26px', color: p.text });
    text(ctx, `of ${of} found`, x + 18 + foundWidth + 8, y + 108, { spec: '400 14px', color: p.muted });
    // Own line, so long counts never run into the found count.
    text(ctx, `${sets(row.setsComplete)} complete · ${pings(row.pings)}`, x + 18, y + 134, { spec: '400 14px', color: p.muted });
}

/** Renders the specials leaderboard. `names` maps user IDs to display names (rows without one show the ID). */
export async function renderSpecialsLeaderboard(board: SpecialsBoard, names: Map<string, string>, palette: Palette = PALETTES[DEFAULT_PALETTE]!): Promise<Buffer> {
    const p = palette;
    const { rows } = board;
    const cardX = FRAME;
    const cardW = WIDTH - FRAME * 2;
    const podium = rows.slice(0, TOP);
    const rest = rows.slice(TOP);

    const headerH = 96;
    const podiumH = podium.length > 0 ? PAD + 26 + PODIUM_HEIGHT + PAD : 0;
    const restH = rest.length > 0 ? 12 + rest.length * ROW + 12 : 0;
    const emptyH = rows.length === 0 ? 80 : 0;
    const height = FRAME + headerH + GAP + (podiumH || emptyH) + (restH > 0 ? GAP + restH : 0) + FRAME;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, WIDTH, height, p);

    // Header: title and window on the left, totals on the right.
    let y = FRAME;
    card(ctx, cardX, y, cardW, headerH, p);
    text(ctx, 'Specials', cardX + PAD, y + 42, { spec: '700 26px', color: p.text });
    text(ctx, `All time · ${board.specialCount} specials in ${sets(board.setCount)}`, cardX + PAD, y + 70, { spec: '400 15px', color: p.muted });
    text(ctx, `${board.totalPings}`, cardX + cardW - PAD, y + 46, { spec: '700 28px', color: p.text, align: 'right' });
    text(ctx, `special pings · ${board.trainers} trainer${board.trainers === 1 ? '' : 's'}`, cardX + cardW - PAD, y + 70, {
        spec: '400 14px',
        color: p.muted,
        align: 'right',
    });
    y += headerH + GAP;

    if (rows.length === 0) {
        card(ctx, cardX, y, cardW, emptyH, p);
        text(ctx, 'No specials found yet.', cardX + PAD, y + 46, { spec: '400 16px', color: p.faint });
        return canvas.encode('png');
    }

    // Podium: the top 3 side by side, under how the board is ranked.
    card(ctx, cardX, y, cardW, podiumH, p);
    let py = y + PAD;
    label(ctx, 'Ranked by sets completed, then specials found, then pings', cardX + PAD, py + 12, 14, p.muted, p);
    py += 26;
    const slotW = (cardW - PAD * 2 - GAP * (TOP - 1)) / TOP;
    podium.forEach((row, i) => {
        drawPodiumCard(ctx, row, i + 1, names.get(row.discordUserId) ?? row.discordUserId, board.specialCount, cardX + PAD + i * (slotW + GAP), py, slotW, PODIUM_HEIGHT, p);
    });
    y += podiumH;

    // Everyone else: name, a bar of specials found against all, sets, found, pings.
    if (rest.length > 0) {
        y += GAP;
        card(ctx, cardX, y, cardW, restH, p);
        const colName = cardX + PAD + 44;
        const colBar = cardX + 380;
        const barW = 200;
        const colSets = cardX + cardW - PAD - 190;
        const colFound = cardX + cardW - PAD - 90;
        const colPings = cardX + cardW - PAD;
        const of = Math.max(1, board.specialCount);
        let ry = y + 12;
        rest.forEach((row, i) => {
            if (i % 2 === 1) fillRound(ctx, cardX + 8, ry, cardW - 16, ROW, innerRadius(p), p.stripe);
            const by = ry + ROW / 2 + 6;
            text(ctx, `${TOP + i + 1}`, cardX + PAD + 28, by, { spec: '400 16px', color: p.muted, align: 'right' });
            const name = names.get(row.discordUserId) ?? row.discordUserId;
            text(ctx, fit(ctx, name, colBar - colName - 20, '400 17px'), colName, by, { spec: '400 17px', color: p.text });
            fillRound(ctx, colBar, by - 9, barW, 6, 3, p.line);
            fillRound(ctx, colBar, by - 9, Math.max(6, (barW * row.found) / of), 6, 3, p.accent);
            text(ctx, sets(row.setsComplete), colSets, by, { spec: '400 14px', color: p.muted, align: 'right' });
            text(ctx, `${row.found}/${board.specialCount}`, colFound, by, { spec: '700 17px', color: p.text, align: 'right' });
            text(ctx, pings(row.pings), colPings, by, { spec: '400 14px', color: p.muted, align: 'right' });
            ry += ROW;
        });
    }

    return canvas.encode('png');
}
