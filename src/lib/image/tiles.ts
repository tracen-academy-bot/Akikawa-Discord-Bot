import type { SKRSContext2D } from '@napi-rs/canvas';
import { font } from './fonts';
import { THEME, drawLabel, drawText } from './theme';

/**
 * Headline statistic tiles, shared by the timer stats card and the trainer
 * report. A tile is a label, one large figure, and an optional detail line.
 *
 * Flat panels with a hairline border rather than rounded cards: the reference
 * design has no radii anywhere, and square edges keep the tracked uppercase
 * labels feeling like part of the same system as the tables.
 */

/** One headline figure. */
export interface Tile {
    label: string;
    value: string;
    /** Smaller line under the value, e.g. a personal best or a comparison. */
    detail?: string;
    color: string;
}

/** Draws a single tile at the given box. */
export function drawTile(ctx: SKRSContext2D, tile: Tile, x: number, y: number, w: number, h: number): void {
    ctx.fillStyle = THEME.bgRaised;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = THEME.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    drawLabel(ctx, tile.label, x + 18, y + 28, THEME.muted, 11);

    // Shrink the figure rather than let it overflow its tile.
    let size = 32;
    ctx.font = font(`700 ${size}px`);
    while (ctx.measureText(tile.value).width > w - 36 && size > 16) {
        size -= 2;
        ctx.font = font(`700 ${size}px`);
    }
    drawText(ctx, tile.value, x + 18, y + 70, { spec: `700 ${size}px`, color: tile.color });

    if (tile.detail) {
        drawText(ctx, tile.detail, x + 18, y + 92, { spec: '400 12px', color: THEME.faint });
    }
}

/** Lays out a row of equal-width tiles across the given span. */
export function drawTileRow(
    ctx: SKRSContext2D,
    tiles: Tile[],
    x: number,
    y: number,
    totalWidth: number,
    height: number,
    gutter = 18,
): void {
    if (tiles.length === 0) return;
    const width = (totalWidth - gutter * (tiles.length - 1)) / tiles.length;
    tiles.forEach((tile, i) => drawTile(ctx, tile, x + i * (width + gutter), y, width, height));
}
