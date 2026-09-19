import type { SKRSContext2D } from '@napi-rs/canvas';
import { font } from './fonts';

/**
 * Visual system shared by every rendered image.
 *
 * One accent colour -- gold -- carries structure: rules, headings, the figure
 * a trainer needs to hit. Red is reserved for a single meaning, "behind", so it
 * keeps its urgency. Everything else is a warm near-black and a short scale of
 * warm greys. Placement colours mark the top four by a left bar and name tint
 * rather than by medal glyphs.
 */
export const THEME = {
    bg: '#0c0b0b',
    bgRaised: '#121010',
    gold: '#d4a54a',
    goldDim: 'rgba(212, 165, 74, 0.55)',
    text: '#e9e6df',
    muted: '#8b877f',
    faint: '#5e5b55',
    line: '#1e1b19',
    red: '#d0584c',
    green: '#8fbf6a',
    /** 1st through 4th place. */
    place: ['#e9c8f2', '#d4a54a', '#d5d6dc', '#c97c4c'] as const,
} as const;

/** Placement colour for a 1-based rank, or null past fourth. */
export function placeColor(rank: number): string | null {
    return THEME.place[rank - 1] ?? null;
}

/** Text drawing options. */
export interface TextOptions {
    /** Weight and size, e.g. `'500 14px'`. */
    spec: string;
    color: string;
    align?: CanvasTextAlign;
    /** Extra tracking in pixels. Headings in the reference are tracked wide. */
    tracking?: number;
}

/**
 * Draws text with the theme's font and optional tracking.
 *
 * Resets letter spacing afterwards so a tracked heading never leaks into the
 * body text drawn next.
 */
export function drawText(ctx: SKRSContext2D, text: string, x: number, y: number, options: TextOptions): number {
    ctx.font = font(options.spec);
    ctx.fillStyle = options.color;
    ctx.textAlign = options.align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = `${options.tracking ?? 0}px`;
    ctx.fillText(text, x, y);
    const width = ctx.measureText(text).width;
    ctx.letterSpacing = '0px';
    return width;
}

/** Uppercase, tracked label -- the reference's heading and column style. */
export function drawLabel(ctx: SKRSContext2D, text: string, x: number, y: number, color: string, size = 12, align: CanvasTextAlign = 'left') {
    drawText(ctx, text.toUpperCase(), x, y, { spec: `400 ${size}px`, color, align, tracking: Math.max(1.5, size * 0.16) });
}

/** Horizontal rule. Gold for structure, `line` for row separators. */
export function drawRule(ctx: SKRSContext2D, x: number, y: number, width: number, color: string, thickness = 1) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, thickness);
}

/** Formats a nullable number with separators, or an em dash. */
export function dashNum(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : value.toLocaleString('en-US');
}
