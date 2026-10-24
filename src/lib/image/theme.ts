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
    faint: '#6e6a63',
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

/** Horizontal anchor. Declared locally so no DOM lib is needed to compile. */
export type Align = 'left' | 'right' | 'center' | 'start' | 'end';

/** Text drawing options. */
export interface TextOptions {
    /** Weight and size, e.g. `'500 14px'`. */
    spec: string;
    color: string;
    align?: Align;
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
export function drawLabel(ctx: SKRSContext2D, text: string, x: number, y: number, color: string, size = 12, align: Align = 'left') {
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

/**
 * A colour set for the fan report. Each key carries one meaning, so a palette
 * can change every colour without changing what any colour says:
 *
 *   accent   structure: the club name, rules, the progress bar, rank-ups
 *   target   the figure a trainer has to hit (daily target)
 *   good     on pace
 *   behind   behind, and nothing else
 *   place    name tints and left bars for 1st through 4th
 *
 * `text`, `muted` and `faint` are a three-step grey scale for figures by
 * importance; `faint` is for de-emphasised values such as dashes and should
 * stay readable (contrast at least 3:1 on `bg`), see `scripts/palettes.ts`.
 */
export interface Palette {
    /** Identifier, as a club would pick it. */
    id: string;
    /** Human name, e.g. "Jewel". */
    label: string;
    /** One line on where it comes from. */
    origin: string;
    bg: string;
    line: string;
    text: string;
    muted: string;
    faint: string;
    accent: string;
    target: string;
    good: string;
    behind: string;
    place: readonly [string, string, string, string];
}

/**
 * Palettes the fan report can render in. `classic` is the current look and
 * the default; the others are candidates for the club to choose from.
 */
export const PALETTES: Record<string, Palette> = {
    classic: {
        id: 'classic',
        label: 'Classic',
        origin: 'The current look: gold on warm black.',
        bg: THEME.bg,
        line: THEME.line,
        text: THEME.text,
        muted: THEME.muted,
        faint: THEME.faint,
        accent: THEME.gold,
        target: THEME.gold,
        good: THEME.green,
        behind: THEME.red,
        place: THEME.place,
    },
    jewel: {
        id: 'jewel',
        label: 'Jewel',
        origin: "viinus's jewel tones (#F1C40F, #16A085, #E74C3C, #00BFFF), 2026-10-21.",
        bg: '#0b0d10',
        line: '#1c2026',
        text: '#ecf0f1',
        muted: '#95a5a6',
        faint: '#66727a',
        accent: '#00bfff',
        target: '#f1c40f',
        good: '#16a085',
        behind: '#e74c3c',
        place: ['#f1c40f', '#d5dbdf', '#e67e22', '#00bfff'],
    },
    navy: {
        id: 'navy',
        label: 'Navy',
        origin: 'The unmerged redesign branch (claude/redesign, 2026-10-01).',
        bg: '#0f1422',
        line: '#242d47',
        text: '#e8ecf6',
        muted: '#98a2bb',
        faint: '#68728f',
        accent: '#5aa9ff',
        target: '#f2b84b',
        good: '#5aa9ff',
        behind: '#ff6b6b',
        place: ['#f5c84c', '#cfd6e4', '#e0965f', '#a78bfa'],
    },
    akikawa: {
        id: 'akikawa',
        label: 'Akikawa',
        origin: "Hues sampled from the bot's avatar (honey hair, blue eyes, pink), saturated for legibility.",
        bg: '#120d0c',
        line: '#2a1f1c',
        text: '#fbf3ea',
        muted: '#b39c8c',
        faint: '#7a675b',
        accent: '#eaa868',
        target: '#eaa868',
        good: '#7fa6ff',
        behind: '#ff6b6b',
        place: ['#f6a5c0', '#eaa868', '#e6dfd8', '#7fa6ff'],
    },
    clear: {
        id: 'clear',
        label: 'Clear',
        origin: 'Okabe-Ito colours (Color Universal Design): behind and on pace stay distinct with red-green colour blindness.',
        bg: '#0c0c0e',
        line: '#202024',
        text: '#f2f2f2',
        muted: '#a3a3a8',
        faint: '#74747a',
        accent: '#56b4e9',
        target: '#f0e442',
        good: '#56b4e9',
        behind: '#e69f00',
        place: ['#f0e442', '#e2e2e2', '#cc79a7', '#009e73'],
    },
};

/** The palette for an id, falling back to `classic` for an unknown one. */
export function paletteOf(id: string | null | undefined): Palette {
    return (id && PALETTES[id]) || PALETTES.classic!;
}
