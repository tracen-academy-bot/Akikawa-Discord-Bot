import type { SKRSContext2D } from '@napi-rs/canvas';
import { font } from './fonts';
import { THEME, drawLabel, drawText, fillRoundRect } from './theme';

/**
 * Headline statistic tiles, shared by the timer stats card and the trainer
 * report. A tile is a label, one large figure, and an optional detail line.
 *
 * Rounded raised panels on the card surface, the same radius and fill as the
 * table head band, so tiles and tables read as one system.
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
    fillRoundRect(ctx, x, y, w, h, 14, THEME.surfaceAlt);

    drawLabel(ctx, tile.label, x + 20, y + 30, THEME.muted, 11);

    // Shrink the figure rather than let it overflow its tile.
    let size = 32;
    ctx.font = font(`700 ${size}px`);
    while (ctx.measureText(tile.value).width > w - 40 && size > 16) {
        size -= 2;
        ctx.font = font(`700 ${size}px`);
    }
    drawText(ctx, tile.value, x + 20, y + 72, { spec: `700 ${size}px`, color: tile.color });

    if (tile.detail) {
        drawText(ctx, tile.detail, x + 20, y + 94, { spec: '400 13px', color: THEME.faint });
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
