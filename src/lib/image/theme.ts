import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { font, monoFont } from './fonts';

/**
 * Visual system shared by every rendered image, and mirrored by the dashboard
 * stylesheet in `src/web/views.ts`. Change a colour here and there together.
 *
 * Layout: every image is one rounded card on a darker page, with a standard
 * header (eyebrow, title, subtitle, stat block on the right), a tinted band
 * over each table, and a footer line.
 *
 * Colour carries meaning, and each colour carries one:
 *   accent (blue)  brand and "on track": eyebrows, primary series, pace bars
 *   amber          "close" or "needs attention": need/day, near-quota pace
 *   red            "behind", and nothing else
 *   place tints    1st / 2nd / 3rd: gold, silver, bronze
 *   violet         a second, neutral series (e.g. your club against tiers)
 * Everything else is the navy surface and a three-step grey scale.
 */
export const THEME = {
    /** Page behind the card. */
    bg: '#0a0e18',
    /** The card itself. */
    surface: '#111726',
    /** Raised areas inside the card: table head band, tiles, zebra rows. */
    surfaceAlt: '#182036',
    /** Hairlines and empty bar tracks. */
    line: '#242d47',
    text: '#e8ecf6',
    muted: '#98a2bb',
    faint: '#5f6986',
    accent: '#5aa9ff',
    amber: '#f2b84b',
    red: '#ff6b6b',
    violet: '#a78bfa',
    /** 1st through 3rd place. */
    place: ['#f5c84c', '#cfd6e4', '#e0965f'] as const,
} as const;

/** Distance from the canvas edge to the card edge. */
export const CARD_INSET = 16;
/** Distance from the canvas edge to content. Every renderer lays out from this. */
export const MARGIN = 56;
const CARD_RADIUS = 22;

/** `#rrggbb` plus an alpha, as an `rgba()` string. */
export function alpha(hex: string, a: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Placement colour for a 1-based rank, or null past third. */
export function placeColor(rank: number): string | null {
    return THEME.place[rank - 1] ?? null;
}

/**
 * Colour for a percentage of target: accent at or above it, amber within
 * `closeAt` percent, red below. One rule for every pace and goal figure.
 */
export function paceColor(pct: number, closeAt = 90): string {
    if (pct >= 100) return THEME.accent;
    if (pct >= closeAt) return THEME.amber;
    return THEME.red;
}

/** Horizontal anchor. Declared locally so no DOM lib is needed to compile. */
export type Align = 'left' | 'right' | 'center' | 'start' | 'end';

/** Text drawing options. */
export interface TextOptions {
    /** Weight and size, e.g. `'700 14px'`. The sans face has 400 and 700 only. */
    spec: string;
    color: string;
    align?: Align;
    /** Extra tracking in pixels, for uppercase labels. */
    tracking?: number;
    /** Use the monospace stack (identifiers). Defaults to the sans stack. */
    mono?: boolean;
}

/**
 * Draws text and returns its width.
 *
 * Resets letter spacing afterwards so a tracked label never leaks into the
 * body text drawn next.
 */
export function drawText(ctx: SKRSContext2D, text: string, x: number, y: number, options: TextOptions): number {
    ctx.font = options.mono ? monoFont(options.spec) : font(options.spec);
    ctx.fillStyle = options.color;
    ctx.textAlign = options.align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = `${options.tracking ?? 0}px`;
    ctx.fillText(text, x, y);
    const width = ctx.measureText(text).width;
    ctx.letterSpacing = '0px';
    return width;
}

/** Uppercase, tracked label: column heads, tile labels, eyebrows. */
export function drawLabel(ctx: SKRSContext2D, text: string, x: number, y: number, color: string, size = 12, align: Align = 'left') {
    drawText(ctx, text.toUpperCase(), x, y, { spec: `700 ${size}px`, color, align, tracking: Math.max(1, size * 0.1) });
}

/** Horizontal rule. */
export function drawRule(ctx: SKRSContext2D, x: number, y: number, width: number, color: string, thickness = 1) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, thickness);
}

/** Formats a nullable number with separators, or an em dash. */
export function dashNum(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : Math.round(value).toLocaleString('en-US');
}

/**
 * Truncates with an ellipsis until the text fits. Sets `spec` on the context
 * first, so the measurement uses the font the text will be drawn in.
 */
export function fit(ctx: SKRSContext2D, text: string, maxWidth: number, spec: string): string {
    ctx.font = font(spec);
    let out = text;
    while (ctx.measureText(out).width > maxWidth && out.length > 1) out = `${out.slice(0, -2)}…`;
    return out;
}

/** Traces a rounded rectangle path. Fill or stroke it afterwards. */
export function roundRectPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

/** Fills a rounded rectangle. */
export function fillRoundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, color: string) {
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
}

/**
 * Creates a canvas with the page background and the card drawn on it.
 *
 * The card carries a faint accent glow along its top edge so the header reads
 * as the top of an object rather than the top of a rectangle.
 */
export function beginCard(width: number, height: number): { canvas: Canvas; ctx: SKRSContext2D } {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, width, height);

    const w = width - CARD_INSET * 2;
    const h = height - CARD_INSET * 2;
    fillRoundRect(ctx, CARD_INSET, CARD_INSET, w, h, CARD_RADIUS, THEME.surface);

    ctx.save();
    roundRectPath(ctx, CARD_INSET, CARD_INSET, w, h, CARD_RADIUS);
    ctx.clip();
    const glow = ctx.createLinearGradient(0, CARD_INSET, 0, CARD_INSET + 220);
    glow.addColorStop(0, alpha(THEME.accent, 0.1));
    glow.addColorStop(1, alpha(THEME.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(CARD_INSET, CARD_INSET, w, 220);
    ctx.restore();

    roundRectPath(ctx, CARD_INSET + 0.5, CARD_INSET + 0.5, w - 1, h - 1, CARD_RADIUS);
    ctx.strokeStyle = THEME.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    return { canvas, ctx };
}

/** One figure in a header's stat block. */
export interface HeaderStat {
    label: string;
    value: string;
    color?: string;
}

export interface HeaderOptions {
    /** Small tracked line above the title, e.g. "Fan report · October 1, 2026". */
    eyebrow: string;
    title: string;
    subtitle?: string;
    /** Up to four figures, laid out right to left from the margin. */
    stats?: HeaderStat[];
}

/** Height every header occupies, from the canvas top to its divider. */
export const HEADER_HEIGHT = 150;

/**
 * Draws the standard header and its divider. Returns the y just below it.
 *
 * The title is truncated so it never runs into the stat block.
 */
export function drawHeader(ctx: SKRSContext2D, width: number, options: HeaderOptions): number {
    const right = width - MARGIN;

    // Stat block first, so the title knows how much room it has.
    let statLeft = right;
    const stats = options.stats ?? [];
    for (let i = stats.length - 1; i >= 0; i -= 1) {
        const stat = stats[i]!;
        ctx.font = font('700 30px');
        const valueWidth = ctx.measureText(stat.value).width;
        ctx.font = font('700 11px');
        const labelWidth = ctx.measureText(stat.label.toUpperCase()).width + stat.label.length * 1.1;
        const colWidth = Math.max(valueWidth, labelWidth);
        drawLabel(ctx, stat.label, statLeft, 76, THEME.faint, 11, 'right');
        drawText(ctx, stat.value, statLeft, 112, { spec: '700 30px', color: stat.color ?? THEME.text, align: 'right' });
        statLeft -= colWidth + 40;
    }

    drawLabel(ctx, options.eyebrow, MARGIN, 64, THEME.accent, 12);
    const titleSpec = '700 38px';
    const title = fit(ctx, options.title, statLeft - MARGIN - 24, titleSpec);
    drawText(ctx, title, MARGIN, 108, { spec: titleSpec, color: THEME.text });
    if (options.subtitle) {
        drawText(ctx, options.subtitle, MARGIN, 136, { spec: '400 16px', color: THEME.muted });
    }

    drawRule(ctx, MARGIN, HEADER_HEIGHT, width - MARGIN * 2, THEME.line);
    return HEADER_HEIGHT + 1;
}

/** A table column heading. `x` is the left edge, or the right edge when right-aligned. */
export interface Column {
    label: string;
    x: number;
    align?: Align;
}

/** Height of the band behind a table's column headings. */
export const TABLE_HEAD_HEIGHT = 40;

/** Draws the tinted band and the column labels. Returns the y below the band. */
export function drawTableHead(ctx: SKRSContext2D, y: number, width: number, columns: Column[]): number {
    fillRoundRect(ctx, MARGIN - 12, y, width - (MARGIN - 12) * 2, TABLE_HEAD_HEIGHT, 10, THEME.surfaceAlt);
    for (const c of columns) drawLabel(ctx, c.label, c.x, y + 25, THEME.muted, 11, c.align ?? 'left');
    return y + TABLE_HEAD_HEIGHT;
}

/** Faint fill behind every other row, so long tables can be read across. */
export function drawZebra(ctx: SKRSContext2D, y: number, width: number, height: number, index: number) {
    if (index % 2 === 1) fillRoundRect(ctx, MARGIN - 12, y, width - (MARGIN - 12) * 2, height, 8, alpha('#ffffff', 0.025));
}

/**
 * Pill progress bar centred on `cy`. `ratio` is clamped to [0, 1]; any
 * non-zero ratio draws at least a dot, so "almost nothing" never reads as
 * "nothing".
 */
export function drawProgressBar(ctx: SKRSContext2D, x: number, cy: number, w: number, h: number, ratio: number, color: string) {
    const r = Math.max(0, Math.min(1, ratio));
    fillRoundRect(ctx, x, cy - h / 2, w, h, h / 2, THEME.line);
    if (r > 0) fillRoundRect(ctx, x, cy - h / 2, Math.max(h, w * r), h, h / 2, color);
}

/**
 * Rank number in a circle. The top three get their place tint; the rest are
 * plain so the podium stands out.
 */
export function drawRankChip(ctx: SKRSContext2D, rank: number, cx: number, cy: number, radius = 15) {
    const tint = placeColor(rank);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = tint ? alpha(tint, 0.16) : THEME.surfaceAlt;
    ctx.fill();
    if (tint) {
        ctx.strokeStyle = alpha(tint, 0.6);
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    const size = rank >= 100 ? 11 : 14;
    drawText(ctx, String(rank), cx, cy + size * 0.36, { spec: `700 ${size}px`, color: tint ?? THEME.muted, align: 'center' });
}

/** Height reserved for the footer line inside the card. */
export const FOOTER_HEIGHT = 64;

/** Footer: source on the left, an optional summary on the right. */
export function drawFooter(ctx: SKRSContext2D, width: number, height: number, left: string, right?: string) {
    const y = height - CARD_INSET - 26;
    drawText(ctx, left, MARGIN, y, { spec: '400 13px', color: THEME.faint });
    if (right) drawText(ctx, right, width - MARGIN, y, { spec: '700 13px', color: THEME.muted, align: 'right' });
}

/** Message for an empty table, in the row area. */
export function drawEmpty(ctx: SKRSContext2D, y: number, text: string) {
    drawText(ctx, text, MARGIN, y + 34, { spec: '400 16px', color: THEME.faint });
}
