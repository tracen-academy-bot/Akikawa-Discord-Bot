import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { DEFAULT_PALETTE, PALETTES, type Palette } from './theme';
import { card, drawFrame, fillRound, fit, innerRadius, text } from './cards';
import { SPECIAL_POINTS, type SpecialsBoard, type SpecialsBoardRow } from '../timer/rares';

/**
 * The specials leaderboard, in the same card style as the runs board: a
 * header (how points are scored, the server's special pings and trainers)
 * and the top 3, each with their points as the main number and, under it,
 * specials found, sets completed and pings.
 */

const WIDTH = 900;
const FRAME = 16;
const GAP = 12;
const PAD = 24;
const PODIUM_HEIGHT = 150;
/** Places shown. */
export const SPECIALS_BOARD_PLACES = 3;

/** "1 set", "2 sets". */
function sets(n: number): string {
    return `${n} set${n === 1 ? '' : 's'}`;
}

/** "1 ping", "31 pings". */
function pings(n: number): string {
    return `${n} ping${n === 1 ? '' : 's'}`;
}

/** One podium card: place and points on top, name, then found, sets and pings. */
function drawPodiumCard(ctx: SKRSContext2D, row: SpecialsBoardRow, place: number, name: string, of: number, x: number, y: number, w: number, h: number, p: Palette) {
    fillRound(ctx, x, y, w, h, innerRadius(p) + 4, p.panel);
    const tint = p.place[place - 1] ?? p.accent;
    fillRound(ctx, x, y, w, 4, 2, tint);
    text(ctx, `${place}`, x + 18, y + 44, { spec: '700 30px', color: tint });
    const ptsWidth = text(ctx, 'pts', x + w - 18, y + 44, { spec: '400 14px', color: p.muted, align: 'right' });
    text(ctx, `${row.points}`, x + w - 18 - ptsWidth - 6, y + 44, { spec: '700 30px', color: p.text, align: 'right' });
    text(ctx, fit(ctx, name, w - 36, '700 18px'), x + 18, y + 80, { spec: '700 18px', color: p.text });
    text(ctx, `${row.found} of ${of} found`, x + 18, y + 110, { spec: '400 14px', color: p.muted });
    text(ctx, `${sets(row.setsComplete)} complete · ${pings(row.pings)}`, x + 18, y + 134, { spec: '400 14px', color: p.muted });
}

/** Renders the specials leaderboard's top 3. `names` maps user IDs to display names (rows without one show the ID). */
export async function renderSpecialsLeaderboard(board: SpecialsBoard, names: Map<string, string>, palette: Palette = PALETTES[DEFAULT_PALETTE]!): Promise<Buffer> {
    const p = palette;
    const podium = board.rows.slice(0, SPECIALS_BOARD_PLACES);
    const cardX = FRAME;
    const cardW = WIDTH - FRAME * 2;

    const headerH = 96;
    const bodyH = podium.length > 0 ? PAD + PODIUM_HEIGHT + PAD : 80;
    const height = FRAME + headerH + GAP + bodyH + FRAME;

    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, WIDTH, height, p);

    // Header: title and how points work on the left, totals on the right.
    let y = FRAME;
    card(ctx, cardX, y, cardW, headerH, p);
    text(ctx, 'Specials · all time', cardX + PAD, y + 42, { spec: '700 26px', color: p.text });
    text(ctx, `${SPECIAL_POINTS.found} pts a new special · ${SPECIAL_POINTS.repeat} a repeat · ${SPECIAL_POINTS.set} a full set`, cardX + PAD, y + 70, {
        spec: '400 15px',
        color: p.muted,
    });
    text(ctx, `${board.totalPings}`, cardX + cardW - PAD, y + 46, { spec: '700 28px', color: p.text, align: 'right' });
    text(ctx, `special pings · ${board.trainers} trainer${board.trainers === 1 ? '' : 's'}`, cardX + cardW - PAD, y + 70, {
        spec: '400 14px',
        color: p.muted,
        align: 'right',
    });
    y += headerH + GAP;

    card(ctx, cardX, y, cardW, bodyH, p);
    if (podium.length === 0) {
        text(ctx, 'No specials found yet.', cardX + PAD, y + 46, { spec: '400 16px', color: p.faint });
        return canvas.encode('png');
    }
    const slotW = (cardW - PAD * 2 - GAP * (SPECIALS_BOARD_PLACES - 1)) / SPECIALS_BOARD_PLACES;
    podium.forEach((row, i) => {
        drawPodiumCard(ctx, row, i + 1, names.get(row.discordUserId) ?? row.discordUserId, board.specialCount, cardX + PAD + i * (slotW + GAP), y + PAD, slotW, PODIUM_HEIGHT, p);
    });
    return canvas.encode('png');
}
