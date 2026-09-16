import type { SKRSContext2D } from '@napi-rs/canvas';
import { roundRect } from './canvasUtils';
import { font } from './fonts';

/**
 * Headline statistic tiles, shared by the timer stats card and the trainer
 * report. A tile is a label, one large figure, and an optional detail line.
 */

const TEXT_FAINT = '#6b7280';
const TEXT_MUTED = '#9ba3b4';
const HAIRLINE = 'rgba(255, 255, 255, 0.08)';

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
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = HAIRLINE;
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 14);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.font = font('bold 13px');
    ctx.fillStyle = TEXT_FAINT;
    ctx.fillText(tile.label.toUpperCase(), x + 18, y + 28);

    // Shrink the figure rather than let it overflow its tile.
    let size = 34;
    ctx.font = font(`bold ${size}px`);
    while (ctx.measureText(tile.value).width > w - 36 && size > 16) {
        size -= 2;
        ctx.font = font(`bold ${size}px`);
    }
    ctx.fillStyle = tile.color;
    ctx.fillText(tile.value, x + 18, y + 70);

    if (tile.detail) {
        ctx.font = font('13px');
        ctx.fillStyle = TEXT_MUTED;
        ctx.fillText(tile.detail, x + 18, y + 92);
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
